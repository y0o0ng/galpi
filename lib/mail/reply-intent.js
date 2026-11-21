'use strict';

const REPLY_COMMAND = /(?:답장|회신)(?:을)?\s*(?:좀\s*)?(?:해\s*(?:줘|주세요)?|보내\s*(?:줘|주세요|세요)?)[.!。]?$/u;
const DRAFT_COMMAND = /(?:답장|회신)\s*초안(?:만|을)?\s*(?:써|작성해|만들어)\s*(?:줘|주세요)?[.!。]?$/u;
const UNSUPPORTED = /전체\s*답장|모두에게\s*답장|참조(?:에도|로)|회신\s*대상\s*변경|전달|새\s*메일|자동\s*(?:발송|답장|회신)|(?:앞으로|알아서|매번|항상|다음부터)/u;
const NON_COMMAND = /^(?:[>\x60])|(?:답장|회신|발송)(?:은|을|는)?\s*(?:말고|하지\s*마|안\s*해)|(?:보내|답장해|회신해)\s*지?\s*마|(?:예시|인용|번역|문장|명령)(?:로|을|만|이야|이야기)|예를\s*들어|예컨대|가령|만약|답장.*(?:해도\s*돼|할까)/u;

function parseMailReplyRequest(message, selectedId = null) {
  if (typeof message !== 'string') return null;
  const text = message.trim();
  const explicitMailContext = selectedId !== null || /메일/u.test(text)
    || REPLY_COMMAND.test(text) || DRAFT_COMMAND.test(text);
  if (!explicitMailContext) return null;
  const mentionsReply = /답장|회신/u.test(text);
  if (!mentionsReply && selectedId === null) return null;
  if (mentionsReply && UNSUPPORTED.test(text)) return { kind: 'unsupported' };
  if (NON_COMMAND.test(text) || !mentionsReply || /[\r\n]/.test(text)) {
    return selectedId !== null ? { kind: 'clarify' } : null;
  }

  const named = /^(.{1,120}?)\s*(?:이메일|메일)에(?:다가)?\s*(.+)$/u.exec(text);
  const target = named && !/^(?:이|해당|그|이런)$/u.test(named[1].trim())
    ? named[1].trim().replace(/^["'“‘「]|["'”’」]$/gu, '').trim()
    : null;
  const command = named?.[2] ?? text;
  const draft = DRAFT_COMMAND.exec(command);
  if (draft) {
    return { kind: 'draft', target, instruction: command.slice(0, draft.index).trim() };
  }
  const suffix = REPLY_COMMAND.exec(command);
  if (!suffix) return selectedId !== null ? { kind: 'clarify' } : null;
  const content = command.slice(0, suffix.index).trim();
  const quoted = /^(?:"([^"]+)"|“([^”]+)”|'([^']+)'|‘([^’]+)’|「([^」]+)」)\s*(?:이?라고|이라고)?$/u.exec(content);
  const reported = /^([^"'“”‘’「」]+?(?:다고|라고|냐고|자고))$/u.test(content);
  if ((!quoted && (!reported || /에게|한테|(?<!함)께\s|다른\s*(?:주소|계정|수신자)|@/u.test(content)))
    || /답장|회신|발송|보내\s*줘|초안/u.test(content)
    || content.length > 2000) {
    return { kind: 'clarify' };
  }
  return { kind: 'send', target, instruction: quoted ? quoted.slice(1).find(Boolean).trim() : content };
}

module.exports = { parseMailReplyRequest };
