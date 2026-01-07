// API endpoint for generating DOCX files from text content
// Uses docx library to create proper DOCX files

import { handleCORS, setCORSHeaders } from './cors.js';
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';

// Fix Persian Bidi (Bidirectional) text for proper Word display
// Adds Unicode BiDi control characters to handle mixed Persian/English text
function fixPersianBidi(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  
  const RTL = '\u200F'; // Right-to-left mark
  const LTR = '\u200E'; // Left-to-right mark
  
  // Check if text contains Persian/Arabic characters
  const hasPersian = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  
  if (!hasPersian) {
    // If no Persian, return as is
    return text;
  }
  
  // Process each paragraph separately (split by double newlines)
  const paragraphs = text.split(/\n\s*\n/);
  
  const fixedParagraphs = paragraphs.map(paragraph => {
    if (!paragraph.trim()) {
      return paragraph; // Keep empty paragraphs as is
    }
    
    // Split paragraph into lines
    const lines = paragraph.split('\n');
    
    const fixedLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line; // Keep empty lines as is
      }
      
      // Check if line contains Persian
      const lineHasPersian = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(trimmed);
      
      if (!lineHasPersian) {
        return line; // If no Persian, return as is
      }
      
      // Wrap English words/numbers/phrases with LTR marks
      // Strategy: Find sequences of English alphanumeric characters and wrap them
      // This handles: "adobe", "Photoshop", "AI", "2024", "3.5", "test@example.com", etc.
      let fixed = line;
      
      // First, protect email addresses and URLs (they contain @ and : which might interfere)
      const protected = [];
      fixed = fixed.replace(
        /(https?:\/\/[^\s\u0600-\u06FF]+|[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g,
        (match) => {
          const placeholder = `__PROTECTED_${protected.length}__`;
          protected.push({ placeholder, value: match });
          return placeholder;
        }
      );
      
      // Match English words (2+ characters) - more reliable
      fixed = fixed.replace(
        /([a-zA-Z]{2,}(?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?)/g,
        `${LTR}$1${LTR}`
      );
      
      // Match numbers (including decimals and percentages)
      fixed = fixed.replace(
        /([0-9]+(?:\.[0-9]+)?%?)/g,
        `${LTR}$1${LTR}`
      );
      
      // Restore protected email addresses and URLs
      protected.forEach(({ placeholder, value }) => {
        fixed = fixed.replace(placeholder, `${LTR}${value}${LTR}`);
      });
      
      // Add RTL mark at the beginning if line starts with Persian
      const firstChar = trimmed[0];
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(firstChar)) {
        // Find the position of first non-whitespace character in original line
        const firstNonSpaceIndex = line.search(/\S/);
        if (firstNonSpaceIndex >= 0) {
          return line.substring(0, firstNonSpaceIndex) + RTL + line.substring(firstNonSpaceIndex);
        }
        return RTL + fixed;
      }
      
      return fixed;
    });
    
    return fixedLines.join('\n');
  });
  
  return fixedParagraphs.join('\n\n');
}

export default async function handler(req, res) {
  // Handle CORS
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { content, filename } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required and must be a string' });
    }

    console.log(`GENERATE_DOCX: Generating DOCX for ${filename || 'document'}, content length: ${content.length}`);

    // Fix Bidi for Persian text
    const fixedContent = fixPersianBidi(content);
    
    // Split content into paragraphs (split by double newlines or single newlines)
    const paragraphs = fixedContent
      .split(/\n\s*\n|\n/)
      .filter(p => p.trim().length > 0)
      .map(text => {
        const fixedText = text.trim();
        // Check if paragraph contains Persian
        const hasPersian = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(fixedText);
        
        return new Paragraph({
          children: [
            new TextRun({
              text: fixedText,
              font: hasPersian ? 'Vazirmatn' : 'Arial',
              size: 22, // 11pt in half-points
            }),
          ],
          alignment: hasPersian ? AlignmentType.RIGHT : AlignmentType.LEFT,
          bidirectional: hasPersian, // Enable bidirectional support
          spacing: {
            after: 200, // 10pt spacing after paragraph
          },
        });
      });

    // If no paragraphs, create one with the full content
    if (paragraphs.length === 0) {
      const hasPersian = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(content);
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: fixedContent,
              font: hasPersian ? 'Vazirmatn' : 'Arial',
              size: 22,
            }),
          ],
          alignment: hasPersian ? AlignmentType.RIGHT : AlignmentType.LEFT,
          bidirectional: hasPersian,
        })
      );
    }

    // Create document
    const doc = new Document({
      sections: [
        {
          properties: {
            direction: 'rtl', // Right-to-left for Persian
          },
          children: paragraphs,
        },
      ],
    });

    // Generate DOCX buffer
    const buffer = await Packer.toBuffer(doc);

    console.log('GENERATE_DOCX: Success, buffer size:', buffer.length);

    // Set headers for file download
    setCORSHeaders(res);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'document')}.docx"`);
    res.setHeader('Content-Length', buffer.length);

    // Send buffer
    return res.status(200).send(buffer);

  } catch (error) {
    console.error('GENERATE_DOCX_ERROR:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'DOCX_GENERATION_ERROR',
      message: error.message || 'Failed to generate DOCX file'
    });
  }
}

