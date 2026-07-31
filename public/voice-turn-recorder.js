'use strict';

(function setupVoiceTurnRecorder(global) {
  const DEFAULTS = {
    preRollMs: 500,
    postRollMs: 300,
    maxDurationMs: 120000,
    maxBytes: 8 * 1024 * 1024,
    targetSampleRate: 16000,
    processorSize: 4096,
  };

  function mergeSamples(chunks, totalLength) {
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  function resampleLinear(input, inputRate, outputRate) {
    if (inputRate === outputRate) return input;
    const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
    const output = new Float32Array(outputLength);
    const ratio = inputRate / outputRate;
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(input.length - 1, left + 1);
      const mix = position - left;
      output[index] = input[left] + ((input[right] - input[left]) * mix);
    }
    return output;
  }

  function encodePcmWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + (samples.length * 2));
    const view = new DataView(buffer);
    const writeText = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + (samples.length * 2), true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (const value of samples) {
      const bounded = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff, true);
      offset += 2;
    }
    return buffer;
  }

  function create({
    stream,
    onTurnReady = () => {},
    onError = () => {},
    AudioContextClass = global.AudioContext || global.webkitAudioContext,
    BlobClass = global.Blob,
    setTimeoutImpl = global.setTimeout.bind(global),
    clearTimeoutImpl = global.clearTimeout.bind(global),
    ...options
  } = {}) {
    const config = { ...DEFAULTS, ...options };
    if (!stream?.getAudioTracks?.().length) {
      throw new TypeError('오디오 MediaStream이 필요합니다.');
    }
    if (typeof AudioContextClass !== 'function' || typeof BlobClass !== 'function') {
      throw new TypeError('이 브라우저는 보정 녹음을 지원하지 않습니다.');
    }

    let context = null;
    let source = null;
    let processor = null;
    let silentSink = null;
    let active = null;
    let stopped = false;
    let ring = [];
    let ringLength = 0;

    function trimRing(maxSamples) {
      while (ring.length > 1 && ringLength - ring[0].length >= maxSamples) {
        ringLength -= ring[0].length;
        ring.shift();
      }
    }

    function captureSamples(samples) {
      if (stopped || !(samples instanceof Float32Array) || samples.length === 0) return;
      const copy = new Float32Array(samples);
      ring.push(copy);
      ringLength += copy.length;
      trimRing(Math.ceil(context.sampleRate * config.preRollMs / 1000));
      if (!active || active.overLimit) return;
      active.chunks.push(copy);
      active.totalLength += copy.length;
      const maxInputSamples = Math.ceil(context.sampleRate * config.maxDurationMs / 1000);
      const estimatedOutputSamples = Math.ceil(
        active.totalLength * config.targetSampleRate / context.sampleRate,
      );
      if (
        active.totalLength > maxInputSamples
        || 44 + (estimatedOutputSamples * 2) > config.maxBytes
      ) {
        active.overLimit = true;
        active.chunks = [];
        active.totalLength = 0;
      }
    }

    function finalize(turnId) {
      if (!active || active.turnId !== String(turnId)) return;
      const completed = active;
      active = null;
      if (completed.timer) clearTimeoutImpl(completed.timer);
      if (completed.overLimit || completed.totalLength === 0) {
        onTurnReady({
          turnId: completed.turnId,
          errorCode: completed.overLimit ? 'TURN_AUDIO_LIMIT' : 'TURN_AUDIO_EMPTY',
        });
        return;
      }
      try {
        const merged = mergeSamples(completed.chunks, completed.totalLength);
        const resampled = resampleLinear(
          merged,
          context.sampleRate,
          config.targetSampleRate,
        );
        const wav = encodePcmWav(resampled, config.targetSampleRate);
        if (wav.byteLength > config.maxBytes) {
          onTurnReady({ turnId: completed.turnId, errorCode: 'TURN_AUDIO_LIMIT' });
          return;
        }
        onTurnReady({
          turnId: completed.turnId,
          blob: new BlobClass([wav], { type: 'audio/wav' }),
          mimeType: 'audio/wav',
          byteLength: wav.byteLength,
          durationMs: Math.round(resampled.length / config.targetSampleRate * 1000),
        });
      } catch (_) {
        onTurnReady({ turnId: completed.turnId, errorCode: 'TURN_AUDIO_ENCODE_FAILED' });
      }
    }

    async function start() {
      if (context || stopped) return;
      try {
        context = new AudioContextClass();
        if (typeof context.resume === 'function') await context.resume();
        source = context.createMediaStreamSource(stream);
        processor = context.createScriptProcessor(config.processorSize, 1, 1);
        if (typeof context.createMediaStreamDestination !== 'function') {
          throw new TypeError('이 브라우저는 격리된 보정 녹음을 지원하지 않습니다.');
        }
        silentSink = context.createMediaStreamDestination();
        processor.onaudioprocess = event => {
          try {
            captureSamples(event.inputBuffer.getChannelData(0));
          } catch (error) {
            onError(error);
          }
        };
        source.connect(processor);
        processor.connect(silentSink);
      } catch (error) {
        processor?.disconnect?.();
        source?.disconnect?.();
        silentSink?.disconnect?.();
        processor = null;
        source = null;
        silentSink = null;
        const failedContext = context;
        context = null;
        await failedContext?.close?.().catch?.(() => {});
        throw error;
      }
    }

    function beginTurn(turnId) {
      if (!context || stopped) return false;
      const id = String(turnId || '').trim();
      if (!id) return false;
      if (active) finalize(active.turnId);
      const preRoll = ring.map(chunk => new Float32Array(chunk));
      active = {
        turnId: id,
        chunks: preRoll,
        totalLength: preRoll.reduce((sum, chunk) => sum + chunk.length, 0),
        overLimit: false,
        timer: null,
      };
      return true;
    }

    function endTurn(turnId) {
      const id = String(turnId || '').trim();
      if (!active || active.turnId !== id || active.timer) return false;
      active.timer = setTimeoutImpl(() => finalize(id), config.postRollMs);
      return true;
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (active?.timer) clearTimeoutImpl(active.timer);
      active = null;
      ring = [];
      ringLength = 0;
      if (processor) {
        processor.onaudioprocess = null;
        processor.disconnect?.();
      }
      source?.disconnect?.();
      silentSink?.disconnect?.();
      processor = null;
      source = null;
      silentSink = null;
      const closing = context;
      context = null;
      closing?.close?.().catch?.(() => {});
    }

    return {
      beginTurn,
      endTurn,
      start,
      stop,
    };
  }

  global.VoiceTurnRecorder = {
    create,
    encodePcmWav,
    resampleLinear,
  };
})(window);
