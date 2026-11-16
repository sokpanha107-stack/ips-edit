"""Free Khmer <-> English translation using the `deep-translator` library (no API key, no billing)."""
import re

LANG = {'km': 'km', 'en': 'en'}
MAX_CHARS = 4500   # the free web endpoint accepts ~5000 characters per request


def _pieces(line: str):
    if len(line) <= MAX_CHARS:
        return [line]
    out, cur = [], ''
    for part in re.split(r'(?<=[.!?។៕])\s+|\s+', line):
        nxt = f'{cur} {part}'.strip()
        if len(nxt) <= MAX_CHARS:
            cur = nxt
        else:
            if cur: out.append(cur)
            cur = part[:MAX_CHARS]
    if cur: out.append(cur)
    return out


def translate_text(text: str, src: str, dst: str) -> str:
    """Keeps line breaks: every non-empty line is translated on its own so the scene structure survives."""
    if src == dst:
        return text
    from deep_translator import GoogleTranslator
    tr = GoogleTranslator(source=LANG[src], target=LANG[dst])
    out = []
    for line in text.replace('\r', '').split('\n'):
        if not line.strip():
            out.append('')
            continue
        out.append(' '.join((tr.translate(p) or '') for p in _pieces(line.strip())))
    return '\n'.join(out)
