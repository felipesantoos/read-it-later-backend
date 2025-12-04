import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import crypto from 'crypto';

export interface ExtractedMetadata {
  title?: string;
  description?: string;
  favicon?: string;
  coverImage?: string;
  siteName?: string;
  content?: string;
  contentType: 'ARTICLE' | 'BLOG' | 'PDF' | 'YOUTUBE' | 'TWITTER' | 'NEWSLETTER' | 'BOOK' | 'EBOOK';
  wordCount?: number;
  readingTime?: number; // in seconds
  totalPages?: number; // Total number of pages (for books, PDFs, ebooks)
}

export async function extractContent(url: string): Promise<ExtractedMetadata> {
  try {
    // Detect content type from URL
    const contentType = detectContentType(url);

    // For YouTube, Twitter, etc., we'll just extract metadata
    if (contentType === 'YOUTUBE' || contentType === 'TWITTER') {
      return {
        contentType,
        title: extractTitleFromUrl(url),
      };
    }

    // Try to detect total pages for PDFs, BOOKs, and EBOOKs
    let totalPages: number | undefined;
    if (contentType === 'PDF' || contentType === 'BOOK' || contentType === 'EBOOK') {
      totalPages = await tryDetectTotalPages(url, contentType);
    }

    // Fetch the page (using global fetch available in Node.js 18+)
    const response = await globalThis.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Extract metadata
    const metadata: ExtractedMetadata = {
      contentType,
      title: extractTitle(document),
      description: extractDescription(document),
      favicon: extractFavicon(document, url),
      coverImage: extractCoverImage(document),
      siteName: extractSiteName(document),
      totalPages,
    };

    // Use Readability to extract clean content
    try {
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article) {
        metadata.content = article.textContent || article.content;
        metadata.title = article.title || metadata.title;
        
        // Calculate word count and reading time
        if (metadata.content) {
          const words = metadata.content.split(/\s+/).filter(word => word.length > 0);
          metadata.wordCount = words.length;
          // Average reading speed: 200 words per minute
          metadata.readingTime = Math.ceil((words.length / 200) * 60);
        }
      }
    } catch (readabilityError) {
      console.warn('Readability extraction failed, using fallback:', readabilityError);
      // Fallback: try to get content from body
      const body = document.querySelector('body');
      if (body) {
        metadata.content = body.textContent || '';
      }
    }

    return metadata;
  } catch (error) {
    console.error('Error extracting content:', error);
    // Return minimal metadata
    return {
      contentType: detectContentType(url),
      title: extractTitleFromUrl(url),
    };
  }
}

function detectContentType(url: string): ExtractedMetadata['contentType'] {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    return 'YOUTUBE';
  }
  if (urlLower.includes('twitter.com') || urlLower.includes('x.com')) {
    return 'TWITTER';
  }
  if (urlLower.endsWith('.pdf')) {
    return 'PDF';
  }
  if (urlLower.includes('newsletter') || urlLower.includes('substack')) {
    return 'NEWSLETTER';
  }
  
  // Default to ARTICLE
  return 'ARTICLE';
}

function extractTitle(document: Document): string | undefined {
  // Try multiple selectors
  const selectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'title',
    'h1',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.getAttribute('content') || element.textContent;
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return undefined;
}

function extractDescription(document: Document): string | undefined {
  const selectors = [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.getAttribute('content');
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return undefined;
}

function extractFavicon(document: Document, baseUrl: string): string | undefined {
  const selectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const href = element.getAttribute('href');
      if (href) {
        try {
          return new URL(href, baseUrl).toString();
        } catch {
          return href;
        }
      }
    }
  }

  // Fallback: try common favicon paths
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}/favicon.ico`;
  } catch {
    return undefined;
  }
}

function extractCoverImage(document: Document): string | undefined {
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="og:image:url"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.getAttribute('content');
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return undefined;
}

function extractSiteName(document: Document): string | undefined {
  const selectors = [
    'meta[property="og:site_name"]',
    'meta[name="application-name"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.getAttribute('content');
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return undefined;
}

function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'Untitled';
  }
}

export function generateUrlHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/**
 * Attempts to detect the total number of pages for PDFs, books, and ebooks.
 * This is a best-effort function that may not always succeed.
 * For PDFs, this would require a PDF parsing library (e.g., pdf-parse).
 * For EPUBs, this would require an EPUB parsing library.
 * Returns undefined if detection is not possible or fails.
 */
async function tryDetectTotalPages(url: string, contentType: 'PDF' | 'BOOK' | 'EBOOK'): Promise<number | undefined> {
  try {
    // For PDFs, we would need a library like pdf-parse
    // This is a placeholder that can be extended with actual PDF parsing
    if (contentType === 'PDF') {
      // TODO: Implement PDF page count detection using pdf-parse or similar
      // Example:
      // const pdfBuffer = await fetch(url).then(r => r.arrayBuffer());
      // const pdf = await pdfParse(Buffer.from(pdfBuffer));
      // return pdf.numpages;
      return undefined;
    }

    // For EPUBs, we would need an EPUB parsing library
    if (contentType === 'EBOOK') {
      // TODO: Implement EPUB page count detection
      // EPUB files are ZIP archives containing HTML files
      // Would need to parse the .epub file structure
      return undefined;
    }

    // For books, we might try to extract from metadata or API
    if (contentType === 'BOOK') {
      // Could try to fetch from book APIs (Google Books, Open Library, etc.)
      // For now, return undefined to allow manual entry
      return undefined;
    }

    return undefined;
  } catch (error) {
    console.warn('Failed to detect total pages:', error);
    return undefined;
  }
}

