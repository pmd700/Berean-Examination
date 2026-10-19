import { describe, expect, it } from 'vitest';
import { formatScriptureCopy } from '@/lib/scriptureCopy';

const chapter = { id: 1, book: 'Zechariah', chapter_number: 9, version: 'BSB' };

describe('clean scripture clipboard text', () => {
  it('copies multi-passage verses in displayed order with correct citations, excluding headings and notes', () => {
    const material = { ...chapter, study_chapters: [chapter, { id: 2, book: 'Matthew', chapter_number: 21, version: 'BSB' }] };
    expect(formatScriptureCopy(material, { blocks: [
      { type: 'header', text: 'Zion’s Coming King' },
      { type: 'verse', studyChapterId: 1, verseNumber: 9, text: 'Rejoice greatly,\n O Daughter of Zion!', notes: [{ text: 'Do not copy this commentary' }] },
      { type: 'header', text: 'The Triumphal Entry' },
      { type: 'verse', studyChapterId: 2, verseNumber: 1, text: 'As they approached Jerusalem...' },
      { type: 'verse', verseNumber: 2, studyLocator: { book: 'John', chapter_number: 12 }, text: 'The next passage.' },
    ] })).toBe('Zechariah 9:9\nRejoice greatly, O Daughter of Zion!\n\nMatthew 21:1\nAs they approached Jerusalem...\n\nJohn 12:2\nThe next passage.');
  });

  it('extracts rich reading segments without note markers, headings or note bodies', () => {
    expect(formatScriptureCopy({ ...chapter, version: 'NASB2020' }, { richVerses: [
      { heading: 'Heading to omit' },
      { verse: 9, segments: [
        { type: 'verseNumber', text: '9' },
        { type: 'text', text: 'Rejoice ' },
        { type: 'italic', text: 'greatly' },
        { type: 'noteMarker', text: '+', noteBody: 'Commentary to omit' },
        { type: 'lineBreak' },
        { type: 'smallCaps', text: 'O Zion!' },
      ] },
    ] })).toBe('Zechariah 9:9\nRejoice greatly O Zion!');
  });

  it('copies Matthew 16:16-21 under one citation with a line per verse across a subtitle', () => {
    const lines = [
      'Simon Peter answered, “You are the Christ, the Son of the living God.”',
      'And Jesus said to him, “Blessed are you, Simon Barjona, because flesh and blood did not reveal this to you, but My Father who is in heaven.',
      'And I also say to you that you are Peter, and upon this rock I will build My church; and the gates of Hades will not overpower it.',
      'I will give you the keys of the kingdom of heaven; and whatever you bind on earth shall have been bound in heaven, and whatever you loose on earth shall have been loosed in heaven.”',
      'Then He gave the disciples strict orders that they were to tell no one that He was the Christ.',
      'From that time Jesus began to point out to His disciples that it was necessary for Him to go to Jerusalem and to suffer many things from the elders, chief priests, and scribes, and to be killed, and to be raised up on the third day.',
    ];
    const blocks = lines.map((text, index) => ({ type: 'verse', verseNumber: String(index + 16), text,
      notes: [{ text: 'Publisher note to omit', offset: 10 }] }));
    blocks.splice(5, 0, { type: 'header', text: 'Jesus Foretells His Death' });
    expect(formatScriptureCopy({ book: 'Matthew', chapter_number: 16, version: 'NASB' }, { blocks }))
      .toBe(`Matthew 16:16-21\n${lines.join('\n')}`);
  });

  it('keeps incomplete ranges, chapter changes and reverse display order separate', () => {
    const verse = (verseNumber, text, chapterNumber = 9) => ({ type: 'verse', verseNumber, text,
      studyLocator: { book: 'Zechariah', chapter_number: chapterNumber } });
    expect(formatScriptureCopy(chapter, { blocks: [
      verse(9, 'First.'), verse(10, 'Second.'), verse(11, '  '),
      { type: 'request', status: 'error', reference: 'Zechariah 9:11' },
      verse(12, 'After the gap.'), verse(1, 'Next chapter.', 10), verse(9, 'Repeated passage.'),
    ] })).toBe('Zechariah 9:9-10\nFirst.\nSecond.\n\nZechariah 9:12\nAfter the gap.\n\nZechariah 10:1\nNext chapter.\n\nZechariah 9:9\nRepeated passage.');
  });

  it('groups adjacent passages from the same edition but separates different editions', () => {
    const material = { ...chapter, study_chapters: [chapter, { ...chapter, id: 2 }, { ...chapter, id: 3, version: 'NASB' }] };
    expect(formatScriptureCopy(material, { blocks: [
      { type: 'verse', studyChapterId: 1, verseNumber: 9, text: 'First.' },
      { type: 'verse', studyChapterId: 2, verseNumber: 10, text: 'Second.' },
      { type: 'verse', studyChapterId: 3, verseNumber: 11, text: 'Another edition.' },
    ] })).toBe('Zechariah 9:9-10\nFirst.\nSecond.\n\nZechariah 9:11\nAnother edition.');
  });

  it('returns no output for missing verses rather than copying a heading', () => {
    expect(formatScriptureCopy(chapter, { blocks: [{ type: 'header', text: 'Unavailable' }] })).toBe('');
  });
});
