import { TAG_NAME_MAX } from '@life/shared';
import { dedupeTags, parseInlineTags } from '@/lib/inline-tags';

describe('parseInlineTags (frozen inline #tag behavior)', () => {
  it('extracts every hashtag name, in order', () => {
    expect(parseInlineTags('buy milk #errand #home')).toEqual(['errand', 'home']);
  });

  it('dedupes case-insensitively, keeping first-seen casing', () => {
    expect(parseInlineTags('#Work do thing #work #WORK')).toEqual(['Work']);
  });

  it('ignores a bare # and collapses whitespace-only names', () => {
    expect(parseInlineTags('# #   #real')).toEqual(['real']);
  });

  it('truncates a tag name to TAG_NAME_MAX', () => {
    const long = 'x'.repeat(TAG_NAME_MAX + 25);
    expect(parseInlineTags(`#${long}`)).toEqual(['x'.repeat(TAG_NAME_MAX)]);
  });

  it('finds hashes after punctuation and keeps the non-space run', () => {
    // The frozen inline grammar is `#` + any non-space/non-`#` run, so `!`, `)`
    // and commas stay part of the name.
    expect(parseInlineTags('see(#one),then #two!')).toEqual(['one),then', 'two!']);
  });

  it('returns no tags for a body without hashes', () => {
    expect(parseInlineTags('plain text')).toEqual([]);
  });

  it('dedupeTags trims and drops blanks', () => {
    expect(dedupeTags([' a ', '', 'b', 'A'])).toEqual(['a', 'b']);
  });
});
