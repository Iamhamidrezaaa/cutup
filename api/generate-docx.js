// API endpoint for generating DOCX files from text content
// Uses docx library to create proper DOCX files

import { handleCORS, setCORSHeaders } from './cors.js';
import { Document, Packer, Paragraph, TextRun } from 'docx';

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

    // Split content into paragraphs (split by double newlines or single newlines)
    const paragraphs = content
      .split(/\n\s*\n|\n/)
      .filter(p => p.trim().length > 0)
      .map(text => 
        new Paragraph({
          children: [
            new TextRun({
              text: text.trim(),
              font: 'Vazirmatn',
              size: 22, // 11pt in half-points
            }),
          ],
          spacing: {
            after: 200, // 10pt spacing after paragraph
          },
        })
      );

    // If no paragraphs, create one with the full content
    if (paragraphs.length === 0) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: content,
              font: 'Vazirmatn',
              size: 22,
            }),
          ],
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

