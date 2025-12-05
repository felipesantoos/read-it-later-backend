import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { marked } from 'marked';
import EPub from 'epub';
import { ExtractedMetadata } from './contentExtractor';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/html',
  'text/plain',
  'text/markdown',
  'application/epub+zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.html',
  '.htm',
  '.txt',
  '.md',
  '.markdown',
  '.epub',
  '.docx',
  '.doc',
];

/**
 * Detect file type from MIME type or extension
 */
export function detectFileType(fileName: string, mimeType?: string): ExtractedMetadata['contentType'] {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  
  if (mimeType) {
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType === 'application/epub+zip') return 'EBOOK';
    if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return 'BOOK';
    if (mimeType === 'text/markdown') return 'ARTICLE';
    if (mimeType === 'text/html' || mimeType === 'text/plain') return 'ARTICLE';
  }

  if (extension === '.pdf') return 'PDF';
  if (extension === '.epub') return 'EBOOK';
  if (extension === '.docx' || extension === '.doc') return 'BOOK';
  if (extension === '.md' || extension === '.markdown') return 'ARTICLE';
  if (extension === '.html' || extension === '.htm') return 'ARTICLE';
  if (extension === '.txt') return 'ARTICLE';

  return 'ARTICLE';
}

/**
 * Validate if file type is allowed
 */
export function isAllowedFileType(fileName: string, mimeType?: string): boolean {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  
  if (mimeType && ALLOWED_MIME_TYPES.includes(mimeType)) {
    return true;
  }
  
  return ALLOWED_EXTENSIONS.some(ext => extension === ext);
}

/**
 * Process PDF file
 */
async function processPDF(buffer: Buffer): Promise<{ content: string; totalPages?: number }> {
  try {
    const data = await pdfParse(buffer);
    return {
      content: data.text,
      totalPages: data.numpages,
    };
  } catch (error) {
    console.error('Error processing PDF:', error);
    throw new Error('Failed to process PDF file');
  }
}

/**
 * Process HTML file
 */
async function processHTML(buffer: Buffer): Promise<string> {
  try {
    const html = buffer.toString('utf-8');
    const dom = new JSDOM(html, { contentType: 'text/html' });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (article) {
      return article.content || article.textContent || '';
    }
    
    // Fallback: return body content
    const body = dom.window.document.querySelector('body');
    return body ? body.textContent || '' : html;
  } catch (error) {
    console.error('Error processing HTML:', error);
    // Fallback: return raw HTML
    return buffer.toString('utf-8');
  }
}

/**
 * Process plain text file
 */
async function processTXT(buffer: Buffer): Promise<string> {
  try {
    return buffer.toString('utf-8');
  } catch (error) {
    console.error('Error processing TXT:', error);
    throw new Error('Failed to process text file');
  }
}

/**
 * Process Markdown file
 */
async function processMD(buffer: Buffer): Promise<string> {
  try {
    const markdown = buffer.toString('utf-8');
    const html = await marked(markdown);
    return html;
  } catch (error) {
    console.error('Error processing Markdown:', error);
    // Fallback: return raw markdown
    return buffer.toString('utf-8');
  }
}

/**
 * Process EPUB file
 */
async function processEPUB(buffer: Buffer): Promise<{ content: string; totalPages?: number; metadata?: any }> {
  return new Promise((resolve) => {
    try {
      // EPub library can work with buffer
      // The constructor signature is: EPub(epubPath, imagewebroot, chapterwebroot, encoding)
      // For buffer, we pass it as the first parameter
      const epub = new EPub(buffer as any);
      
      epub.on('end', async () => {
        try {
          let fullText = '';
          let chapterCount = 0;

          // Get metadata - epub library returns metadata in different formats
          const epubMetadata = epub.metadata as any;
          const metadata: any = {
            title: Array.isArray(epubMetadata?.title) 
              ? epubMetadata.title[0] 
              : epubMetadata?.title || '',
            creator: Array.isArray(epubMetadata?.creator)
              ? epubMetadata.creator[0]
              : epubMetadata?.creator || '',
            description: Array.isArray(epubMetadata?.description)
              ? epubMetadata.description[0]
              : epubMetadata?.description || '',
          };

          // Extract text from each chapter
          const spine = epub.spine;
          const spineItems = Array.isArray(spine) ? spine : (spine as any).toc || [];
          for (const item of spineItems) {
            try {
              const chapter = await new Promise<string>((resolveChapter, rejectChapter) => {
                epub.getChapter(item.id, (err: Error | null, text: string) => {
                  if (err) {
                    rejectChapter(err);
                  } else {
                    resolveChapter(text || '');
                  }
                });
              });
              
              if (chapter) {
                const dom = new JSDOM(chapter);
                const text = dom.window.document.body?.textContent || '';
                fullText += text + '\n\n';
                chapterCount++;
              }
            } catch (err) {
              console.warn('Error extracting chapter:', err);
            }
          }

          resolve({
            content: fullText.trim(),
            totalPages: chapterCount,
            metadata,
          });
        } catch (error) {
          console.error('Error processing EPUB chapters:', error);
          resolve({
            content: '',
            totalPages: 0,
            metadata: {},
          });
        }
      });

      epub.on('error', (error: Error) => {
        console.error('EPUB parsing error:', error);
        // Return empty content instead of rejecting
        resolve({
          content: '',
          metadata: {},
        });
      });

      epub.parse();
    } catch (error) {
      console.error('Error initializing EPUB parser:', error);
      // Fallback: return empty content
      resolve({
        content: '',
        metadata: {},
      });
    }
  });
}

/**
 * Process DOCX file
 */
async function processDOCX(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error('Error processing DOCX:', error);
    throw new Error('Failed to process DOCX file');
  }
}

/**
 * Extract content from file buffer
 */
export async function extractContentFromFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<ExtractedMetadata> {
  const contentType = detectFileType(fileName, mimeType);
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));

  let content = '';
  let totalPages: number | undefined;
  let metadata: any = {};

  try {
    switch (contentType) {
      case 'PDF':
        const pdfResult = await processPDF(buffer);
        content = pdfResult.content;
        totalPages = pdfResult.totalPages;
        break;

      case 'EBOOK':
        if (extension === '.epub') {
          const epubResult = await processEPUB(buffer);
          content = epubResult.content;
          totalPages = epubResult.totalPages;
          metadata = epubResult.metadata || {};
        } else {
          content = buffer.toString('utf-8');
        }
        break;

      case 'BOOK':
        if (extension === '.docx' || extension === '.doc') {
          content = await processDOCX(buffer);
        } else {
          content = buffer.toString('utf-8');
        }
        break;

      case 'ARTICLE':
      default:
        if (extension === '.html' || extension === '.htm') {
          content = await processHTML(buffer);
        } else if (extension === '.md' || extension === '.markdown') {
          content = await processMD(buffer);
        } else {
          content = await processTXT(buffer);
        }
        break;
    }

    // Calculate word count and reading time
    const words = content.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    const readingTime = Math.ceil((wordCount / 200) * 60); // 200 words per minute

    // Extract title from metadata or filename
    const title = metadata.title || fileName.replace(/\.[^/.]+$/, '');

    return {
      contentType,
      title,
      description: metadata.description,
      content,
      wordCount,
      readingTime,
      totalPages,
      author: metadata.creator || metadata.author,
    };
  } catch (error) {
    console.error('Error extracting content from file:', error);
    // Return minimal metadata on error
    return {
      contentType,
      title: fileName.replace(/\.[^/.]+$/, ''),
      content: '',
    };
  }
}

