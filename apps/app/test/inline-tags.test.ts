import { TAG_NAME_MAX } from '@life/shared';
import { dedupeTags, hasUncommittedTrailingTag, parseInlineTags } from '@/lib/inline-tags';

const final = { eofTerminates: true } as const;

describe('parseInlineTags (#tag is committed by a terminator; end-of-content only when leaving)', () => {
  it('splits a line of finished tags into both names', () => {
    expect(parseInlineTags('buy milk #errand #home ')).toEqual(['errand', 'home']);
  });

  it('dedupes case-insensitively, keeping first-seen casing', () => {
    expect(parseInlineTags('#Work do thing #work #WORK')).toEqual(['Work']);
  });

  it('ignores a bare # and keeps only a terminated word', () => {
    expect(parseInlineTags('# #   #real ')).toEqual(['real']);
  });

  it('truncates a terminated tag name to TAG_NAME_MAX', () => {
    const long = 'x'.repeat(TAG_NAME_MAX + 25);
    expect(parseInlineTags(`#${long} `)).toEqual(['x'.repeat(TAG_NAME_MAX)]);
  });

  it('treats punctuation as a terminator, not part of the name', () => {
    expect(parseInlineTags('see(#one),then #two!')).toEqual(['one', 'two']);
  });

  it('returns no tags for a body without hashes', () => {
    expect(parseInlineTags('plain text')).toEqual([]);
  });

  it('dedupeTags trims and drops blanks', () => {
    expect(dedupeTags([' a ', '', 'b', 'A'])).toEqual(['a', 'b']);
  });

  it('typing "#ho" and pausing mid-word creates no tag — strict autosave ignores it, final save commits it', () => {
    expect(parseInlineTags('buy milk #ho')).toEqual([]);
    expect(parseInlineTags('buy milk #ho', final)).toEqual(['ho']);
    const finished = 'buy milk #home ';
    expect(parseInlineTags(finished)).toEqual(['home']);
    expect(parseInlineTags(finished, final)).toEqual(['home']);
    expect([...parseInlineTags(finished), ...parseInlineTags(finished, final)]).not.toContain('ho');
  });

  it('a note ending on "#home" carries no tag while typing but commits when you leave', () => {
    expect(parseInlineTags('#home')).toEqual([]);
    expect(parseInlineTags('#home', final)).toEqual(['home']);
  });

  it('leaving never changes an already-terminated tag', () => {
    expect(parseInlineTags('Call mom #home.')).toEqual(['home']);
    expect(parseInlineTags('Call mom #home.', final)).toEqual(['home']);
  });

  it('a real shopping list: comma and period commit each item', () => {
    expect(parseInlineTags('Buy #eggs, then #milk.')).toEqual(['eggs', 'milk']);
    expect(parseInlineTags('Buy #eggs, then #milk.', final)).toEqual(['eggs', 'milk']);
  });

  it('a parenthesised tag is committed by the closing paren', () => {
    expect(parseInlineTags('(#grocery) list ')).toEqual(['grocery']);
  });

  it('a multi-line note: a newline commits the tag on line 1', () => {
    expect(parseInlineTags('#errand\ncall back')).toEqual(['errand']);
  });

  it('a Vietnamese tag name is parsed whole, not split', () => {
    expect(parseInlineTags('#nhóm_chính ')).toEqual(['nhóm_chính']);
  });

  it('a hyphenated or underscored tag name stays intact', () => {
    expect(parseInlineTags('#to-do list ')).toEqual(['to-do']);
    expect(parseInlineTags('#my_tag ')).toEqual(['my_tag']);
  });

  it('punctuation splits the name: decimals and operators are not part of it', () => {
    expect(parseInlineTags('#1.5 hours')).toEqual(['1']);
    expect(parseInlineTags('#c++ tips ')).toEqual(['c']);
  });

  it('markdown headings and a bare # are never tags', () => {
    expect(parseInlineTags('## Heading ')).toEqual([]);
    expect(parseInlineTags('text # ')).toEqual([]);
  });

  it('typing forward never leaves a tag the finished text does not have (strict-mode prefix-subset invariant — the autosave path; final mode is never invoked per-keystroke)', () => {
    for (const full of ['Buy #eggs, then #milk.', 'Call mom #home and #work #errand.']) {
      const finished = new Set(parseInlineTags(full));
      for (let i = 0; i <= full.length; i++) {
        for (const name of parseInlineTags(full.slice(0, i))) {
          expect(finished.has(name)).toBe(true);
        }
      }
    }
  });

  it('pasting a URL with a fragment still yields the fragment word (documented limitation)', () => {
    expect(parseInlineTags('https://example.com/page#section ')).toEqual(['section']);
  });

  it('hasUncommittedTrailingTag detects the trailing tag that forces a final save (the dirty-hole predicate)', () => {
    expect(hasUncommittedTrailingTag('buy milk #ho')).toBe(true);
    expect(hasUncommittedTrailingTag('buy milk #home ')).toBe(false);
    expect(hasUncommittedTrailingTag('#home')).toBe(true);
    expect(hasUncommittedTrailingTag('plain text')).toBe(false);
  });
});
