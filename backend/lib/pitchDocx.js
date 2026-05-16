// Serialise a generated pitch object into a Word document Buffer.
//
// Layout — Hartwell & Stone branded letterhead:
//   - Header: firm wordmark + office line (London / Brussels / New York / Frankfurt)
//   - Section title: bold display-style
//   - Section body: serif-ish (Calibri 11), 1.15 line spacing
//   - Footer: confidentiality marker + page numbers
//
// Output: Buffer (binary .docx) suitable for direct send with the right
// Content-Type. No filesystem writes — caller owns the response stream.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, PageNumber, BorderStyle, Table, TableRow, TableCell, WidthType
} from 'docx';

// Defaults used when firmProfile is unset (legacy / single-tenant demo
// behaviour). pitchToDocxBuffer accepts a `firmProfile` so multi-tenant
// deployments brand the docx with the workspace's actual firm details.
const DEFAULT_FIRM_NAME = 'HARTWELL & STONE LLP';
const DEFAULT_FIRM_TAGLINE = 'London  ·  Brussels  ·  New York  ·  Frankfurt';
const DEFAULT_FIRM_CONTACT = 'pitches@hartwellstone.com   ·   +44 20 7000 0000';

function brandingFrom(firmProfile) {
  const name = (firmProfile?.name || DEFAULT_FIRM_NAME).toUpperCase();
  const offices = Array.isArray(firmProfile?.offices) && firmProfile.offices.length
    ? firmProfile.offices.join('  ·  ')
    : DEFAULT_FIRM_TAGLINE;
  const contact = [firmProfile?.contactEmail, firmProfile?.contactPhone]
    .filter(Boolean).join('   ·   ');
  return {
    firmName: name,
    firmTagline: offices,
    firmContact: contact || DEFAULT_FIRM_CONTACT
  };
}

const ACCENT_HEX = '0A0A0A';  // Octave panel black — used for headings + rules.

// Small helpers to keep section construction readable.
function bodyPara(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 300 },
    children: [new TextRun({ text, size: 22, font: 'Calibri', ...opts })] // 22 half-points = 11pt
  });
}

function bulletPara(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80, line: 280 },
    children: [new TextRun({ text, size: 22, font: 'Calibri' })]
  });
}

function sectionHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 160 },
    border: { bottom: { color: ACCENT_HEX, space: 4, style: BorderStyle.SINGLE, size: 6 } },
    children: [new TextRun({
      text: text.toUpperCase(),
      bold: true,
      size: 22,
      font: 'Calibri',
      color: ACCENT_HEX,
      characterSpacing: 60
    })]
  });
}

function title(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 240 },
    children: [new TextRun({
      text,
      bold: true,
      size: 36,           // 18pt
      font: 'Calibri',
      color: ACCENT_HEX
    })]
  });
}

// Letterhead bar at the top of the document.
function letterheadHeader(branding) {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: [new TextRun({
          text: branding.firmName,
          bold: true,
          size: 28,
          font: 'Calibri',
          characterSpacing: 100,
          color: ACCENT_HEX
        })]
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        border: { bottom: { color: ACCENT_HEX, space: 4, style: BorderStyle.SINGLE, size: 8 } },
        spacing: { after: 240 },
        children: [new TextRun({
          text: branding.firmTagline,
          size: 16,
          font: 'Calibri',
          color: '7A7A7A'
        })]
      })
    ]
  });
}

// Footer with confidentiality marker + page numbers.
function letterheadFooter(branding) {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        border: { top: { color: ACCENT_HEX, space: 4, style: BorderStyle.SINGLE, size: 4 } },
        spacing: { before: 120 },
        children: [
          new TextRun({ text: 'CONFIDENTIAL — PARTNER DRAFT   ', size: 16, font: 'Calibri', color: '7A7A7A' }),
          new TextRun({ text: branding.firmContact, size: 16, font: 'Calibri', color: '7A7A7A' }),
          new TextRun({ text: '   ·   Page ', size: 16, font: 'Calibri', color: '7A7A7A' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Calibri', color: '7A7A7A' }),
          new TextRun({ text: ' of ', size: 16, font: 'Calibri', color: '7A7A7A' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: 'Calibri', color: '7A7A7A' })
        ]
      })
    ]
  });
}

// Team block — a two-column light table so partner names line up cleanly.
function teamBlock(team) {
  if (!team || !team.length) return [bodyPara('Team to be confirmed at instruction.')];
  const rows = team.map(t =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          margins: { top: 80, bottom: 80, left: 0, right: 0 },
          children: [new Paragraph({ children: [new TextRun({ text: t.name || '', bold: true, size: 22, font: 'Calibri' })] })]
        }),
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          margins: { top: 80, bottom: 80, left: 120, right: 0 },
          children: [new Paragraph({
            children: [
              new TextRun({ text: t.role || '', size: 22, font: 'Calibri' }),
              ...(t.rationale ? [new TextRun({ text: ` — ${t.rationale}`, italics: true, size: 22, font: 'Calibri', color: '7A7A7A' })] : [])
            ]
          })]
        })
      ]
    })
  );
  return [new Table({
    rows,
    borders: {
      top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'CFCFCF' },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    },
    width: { size: 100, type: WidthType.PERCENTAGE }
  })];
}

function credentialsBlock(creds) {
  if (!creds || !creds.length) return [bodyPara('Credentials to be added at instruction.')];
  return creds.map(c => new Paragraph({
    spacing: { after: 100, line: 280 },
    children: [
      new TextRun({ text: `${c.matterTitle || c.matterId}`, bold: true, size: 22, font: 'Calibri' }),
      ...(c.oneLine ? [new TextRun({ text: ` — ${c.oneLine}`, size: 22, font: 'Calibri', color: '3A3A3A' })] : []),
      ...(c.matterId ? [new TextRun({ text: ` [${c.matterId}]`, size: 18, font: 'Calibri', color: '7A7A7A' })] : [])
    ]
  }));
}

export function pitchToDocxBuffer(pitch, { firmProfile } = {}) {
  if (!pitch) throw new Error('pitchToDocxBuffer: pitch is required');
  const branding = brandingFrom(firmProfile);

  const doc = new Document({
    creator: branding.firmName,
    title: pitch.title || 'Business development pitch',
    sections: [{
      properties: {
        page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } }
      },
      headers: { default: letterheadHeader(branding) },
      footers: { default: letterheadFooter(branding) },
      children: [
        title(pitch.title || 'Business development pitch'),

        sectionHeading('Executive summary'),
        bodyPara(pitch.executiveSummary || ''),

        sectionHeading('Why now'),
        bodyPara(pitch.whyNow || ''),

        sectionHeading('Why us'),
        bodyPara(pitch.whyUs || ''),

        sectionHeading('Team'),
        ...teamBlock(pitch.team || []),

        sectionHeading('Relevant credentials'),
        ...credentialsBlock(pitch.credentials || []),

        sectionHeading('Proposed scope'),
        ...(pitch.scope || []).map(s => bulletPara(s)),

        sectionHeading('Indicative approach'),
        ...(pitch.approach || []).map(a => bulletPara(a)),

        sectionHeading('Fees & engagement'),
        bodyPara(pitch.feesNote || 'Indicative phased fee. Detail to follow on instruction.')
      ]
    }]
  });

  return Packer.toBuffer(doc);
}
