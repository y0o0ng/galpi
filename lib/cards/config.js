'use strict';
const path = require('node:path');
function cardsConfig(env = process.env, root = path.resolve(__dirname, '../..')) {
  return {
    root, enabled: env.CARDS_AGENT_ENABLED === 'true', productionEnabled: env.CARDS_PRODUCTION_ENABLED === 'true',
    uploadEnabled: false, // 카드뉴스는 Instagram에만 수동 게시한다.
    bin: env.CODEX_BIN || '/home/pi/galpi/bin/codex',
    candidateModel: env.CARDS_CANDIDATE_MODEL || 'gpt-6-luna', reviewModel: env.CARDS_REVIEW_MODEL || 'gpt-6.1-sol',
    scriptModel: env.CARDS_SCRIPT_MODEL || 'gpt-6.1-sol', buildModel: env.CARDS_BUILD_MODEL || 'gpt-6.1-sol',
    buildReasoningEffort: env.CARDS_BUILD_REASONING_EFFORT || 'medium',
    python: env.CARDS_PYTHON || path.join(root, 'reels/.venv/bin/python'),
    font: path.join(root, 'reels/px/fonts/Pretendard-Medium.otf'), boldFont: path.join(root, 'reels/px/fonts/Pretendard-Bold.otf'),
    fontIndex: 0, boldIndex: 0,
    workRoot: env.CARDS_WORK_DIR || path.join(root, 'reels/work/cards'),
    mediaRoot: path.join(root, 'reels/media/cards/published'),
  };
}
module.exports = { cardsConfig };
