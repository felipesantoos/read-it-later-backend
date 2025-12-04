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
  author?: string;
  publishedDate?: string;
  images?: string[];
}

// Configuration constants
const FETCH_TIMEOUT = 30000; // 30 seconds
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second

// Simple in-memory cache (can be replaced with Redis or similar)
const contentCache = new Map<string, { data: ExtractedMetadata; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Improved User-Agent to avoid blocking
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function extractContent(url: string, useCache: boolean = true): Promise<ExtractedMetadata> {
  try {
    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Check cache
    if (useCache) {
      const cached = contentCache.get(url);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    // Detect content type from URL
    const contentType = detectContentType(url);

    // For YouTube, Twitter, etc., extract metadata via APIs
    if (contentType === 'YOUTUBE') {
      const metadata = await extractYouTubeMetadata(url);
      if (useCache) {
        contentCache.set(url, { data: metadata, timestamp: Date.now() });
      }
      return metadata;
    }

    if (contentType === 'TWITTER') {
      const metadata = await extractTwitterMetadata(url);
      if (useCache) {
        contentCache.set(url, { data: metadata, timestamp: Date.now() });
      }
      return metadata;
    }

    // Try to detect total pages for PDFs, BOOKs, and EBOOKs
    let totalPages: number | undefined;
    if (contentType === 'PDF' || contentType === 'BOOK' || contentType === 'EBOOK') {
      totalPages = await tryDetectTotalPages(url, contentType);
    }

    // Fetch the page with retry logic
    const html = await fetchWithRetry(url);
    
    // Validate response size
    if (html.length > MAX_RESPONSE_SIZE) {
      console.warn(`Response too large (${html.length} bytes), truncating`);
    }

    // Parse HTML with proper encoding handling
    const dom = new JSDOM(html, { 
      url,
      contentType: 'text/html',
    });
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
      author: extractAuthor(document),
      publishedDate: extractPublishedDate(document),
    };

    // Use Readability to extract clean content
    try {
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article) {
        // Sanitize HTML content
        const sanitizedContent = sanitizeHtml(article.content || '');
        metadata.content = article.textContent || sanitizedContent;
        metadata.title = article.title || metadata.title;
        
        // Extract images from article content
        if (article.content) {
          metadata.images = extractImagesFromHtml(article.content);
        }
        
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
      // Improved fallback: try multiple content selectors
      metadata.content = extractContentFallback(document);
      if (metadata.content) {
        const words = metadata.content.split(/\s+/).filter(word => word.length > 0);
        metadata.wordCount = words.length;
        metadata.readingTime = Math.ceil((words.length / 200) * 60);
      }
    }

    // Cache the result
    if (useCache) {
      contentCache.set(url, { data: metadata, timestamp: Date.now() });
    }

    return metadata;
  } catch (error) {
    console.error('Error extracting content:', error);
    // Return minimal metadata
    const minimalMetadata = {
      contentType: detectContentType(url),
      title: extractTitleFromUrl(url),
    };
    return minimalMetadata;
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
    'link[rel="apple-touch-icon-precomposed"]',
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
    const commonPaths = [
      '/favicon.ico',
      '/favicon.png',
      '/apple-touch-icon.png',
      '/icon.png',
    ];

    // Return the most common one, but could be enhanced to check which exists
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

/**
 * Fetch with timeout, retry logic, and redirect handling
 */
async function fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      const response = await globalThis.fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: controller.signal,
        redirect: 'follow', // Automatically follow redirects
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
        throw new Error(`Response too large: ${contentLength} bytes`);
      }

      // Get text with encoding detection
      const text = await response.text();
      
      // Validate actual size
      if (text.length > MAX_RESPONSE_SIZE) {
        throw new Error(`Response too large: ${text.length} bytes`);
      }

      return text;
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${FETCH_TIMEOUT}ms`);
      }

      if (error.message?.includes('too large')) {
        throw error;
      }

      // If not the last attempt, wait before retrying
      if (attempt < retries) {
        const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
        console.warn(`Fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Failed to fetch after all retries');
}

/**
 * Extract author from document
 */
function extractAuthor(document: Document): string | undefined {
  const selectors = [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[property="og:article:author"]',
    '[rel="author"]',
    '.author',
    '[class*="author"]',
    '[itemprop="author"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.getAttribute('content') || 
                     element.getAttribute('name') ||
                     element.textContent;
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return undefined;
}

/**
 * Extract published date from document
 */
function extractPublishedDate(document: Document): string | undefined {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="published_time"]',
    'meta[name="date"]',
    'meta[property="og:published_time"]',
    'time[datetime]',
    '[itemprop="datePublished"]',
    '[class*="date"]',
    '[class*="published"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.getAttribute('content') || 
                     element.getAttribute('datetime') ||
                     element.getAttribute('pubdate') ||
                     element.textContent;
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return undefined;
}

/**
 * Sanitize HTML content by removing dangerous elements
 */
function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove style tags and their content
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove event handlers from attributes
  html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  
  // Remove javascript: and data: URLs
  html = html.replace(/javascript:/gi, '');
  html = html.replace(/data:text\/html/gi, '');
  
  return html;
}

/**
 * Extract images from HTML content
 */
function extractImagesFromHtml(html: string): string[] {
  const images: string[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !src.startsWith('data:')) {
      images.push(src);
    }
  }

  return images.slice(0, 10); // Limit to 10 images
}

/**
 * Improved fallback content extraction
 */
function extractContentFallback(document: Document): string {
  // Try multiple content selectors
  const contentSelectors = [
    'article',
    '[role="article"]',
    '.content',
    '.post-content',
    '.entry-content',
    '.article-content',
    'main',
    '[class*="content"]',
    '[id*="content"]',
  ];

  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // Remove unwanted elements
      const clone = element.cloneNode(true) as Element;
      const unwanted = clone.querySelectorAll('script, style, nav, header, footer, aside, .ad, .advertisement, [class*="ad"]');
      unwanted.forEach(el => el.remove());
      
      const text = clone.textContent || '';
      if (text.trim().length > 100) {
        return text.trim();
      }
    }
  }

  // Last resort: get body content
  const body = document.querySelector('body');
  if (body) {
    const clone = body.cloneNode(true) as Element;
    const unwanted = clone.querySelectorAll('script, style, nav, header, footer, aside, .ad, .advertisement, [class*="ad"]');
    unwanted.forEach(el => el.remove());
    return clone.textContent || '';
  }

  return '';
}

/**
 * Extract YouTube metadata via oEmbed API
 */
async function extractYouTubeMetadata(url: string): Promise<ExtractedMetadata> {
  try {
    // Extract video ID
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (!videoIdMatch) {
      return {
        contentType: 'YOUTUBE',
        title: extractTitleFromUrl(url),
      };
    }

    const videoId = videoIdMatch[1];
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await globalThis.fetch(oEmbedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return {
          contentType: 'YOUTUBE',
          title: data.title || extractTitleFromUrl(url),
          description: data.description,
          coverImage: data.thumbnail_url,
          siteName: 'YouTube',
          author: data.author_name,
        };
      }
    } catch (error) {
      clearTimeout(timeoutId);
      console.warn('YouTube oEmbed API failed, using fallback:', error);
    }

    // Fallback: try to fetch the page
    try {
      const html = await fetchWithRetry(url);
      const dom = new JSDOM(html, { url });
      const document = dom.window.document;

      return {
        contentType: 'YOUTUBE',
        title: extractTitle(document) || extractTitleFromUrl(url),
        description: extractDescription(document),
        coverImage: extractCoverImage(document),
        siteName: 'YouTube',
      };
    } catch {
      return {
        contentType: 'YOUTUBE',
        title: extractTitleFromUrl(url),
      };
    }
  } catch (error) {
    console.error('Error extracting YouTube metadata:', error);
    return {
      contentType: 'YOUTUBE',
      title: extractTitleFromUrl(url),
    };
  }
}

/**
 * Extract Twitter/X metadata
 */
async function extractTwitterMetadata(url: string): Promise<ExtractedMetadata> {
  try {
    // Try to fetch the page
    const html = await fetchWithRetry(url);
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    return {
      contentType: 'TWITTER',
      title: extractTitle(document) || extractTitleFromUrl(url),
      description: extractDescription(document),
      coverImage: extractCoverImage(document),
      siteName: 'Twitter',
      author: extractAuthor(document),
    };
  } catch (error) {
    console.error('Error extracting Twitter metadata:', error);
    return {
      contentType: 'TWITTER',
      title: extractTitleFromUrl(url),
    };
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

