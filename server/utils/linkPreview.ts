import dns from 'node:dns/promises';
import net from 'node:net';

export interface LinkPreviewMeta {
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi;

function cleanTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,!?;:'")\]}>]+$/, '');
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX) || [];
  const seen = new Set<string>();
  const results: string[] = [];

  for (const raw of matches) {
    const cleaned = cleanTrailingPunctuation(raw.trim());
    const normalized = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
        continue;
      }
      const href = parsed.toString();
      if (!seen.has(href)) {
        seen.add(href);
        results.push(href);
      }
      if (results.length >= 5) break;
    } catch {
      // Ignore malformed URLs
    }
  }

  return results;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    if (lower.startsWith('::ffff:')) {
      return isPrivateIp(lower.slice(7));
    }
    return false;
  }
  return true;
}

async function isSafePublicUrl(rawUrl: string): Promise<URL | null> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return null;
    }

    if (net.isIP(host)) {
      return isPrivateIp(host) ? null : parsed;
    }

    const resolved = await dns.lookup(host, { all: true });
    if (!resolved.length) return null;
    if (resolved.some((entry) => isPrivateIp(entry.address))) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .trim();
}

function extractMetaContent(html: string, keys: string[]): string {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i'
    );
    const m1 = html.match(pattern1);
    if (m1?.[1]) return decodeHtmlEntities(m1[1]);

    const pattern2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      'i'
    );
    const m2 = html.match(pattern2);
    if (m2?.[1]) return decodeHtmlEntities(m2[1]);
  }
  return '';
}

function extractTitleTag(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? decodeHtmlEntities(m[1].replace(/\s+/g, ' ')) : '';
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewMeta> {
  let domain = rawUrl;
  try {
    domain = new URL(rawUrl).hostname.replace(/^www\./i, '');
  } catch {
    // Keep rawUrl fallback
  }

  const fallback: LinkPreviewMeta = {
    url: rawUrl,
    domain,
    title: domain,
    description: '',
    image: '',
    siteName: domain,
  };

  try {
    const safeUrl = await isSafePublicUrl(rawUrl);
    if (!safeUrl) return fallback;

    const response = await fetch(safeUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(2500),
      headers: {
        'User-Agent': 'BlinkUpZ-LinkPreview/1.1 (+https://blinkupz.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) return fallback;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return fallback;
    }

    const reader = response.body?.getReader();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      let bytesRead = 0;
      const maxBytes = 196 * 1024;
      while (bytesRead < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        bytesRead += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (html.includes('</head>')) break;
      }
      reader.cancel().catch(() => undefined);
    } else {
      html = (await response.text()).slice(0, 196 * 1024);
    }

    const ogTitle = extractMetaContent(html, ['og:title', 'twitter:title']);
    const htmlTitle = extractTitleTag(html);
    const title = (ogTitle || htmlTitle || domain).slice(0, 160);
    const description = extractMetaContent(html, [
      'og:description',
      'twitter:description',
      'description',
    ]).slice(0, 300);
    const siteName = (
      extractMetaContent(html, ['og:site_name', 'application-name']) || domain
    ).slice(0, 80);

    let image = extractMetaContent(html, ['og:image', 'twitter:image']);
    if (image) {
      try {
        const resolvedImg = new URL(image, safeUrl);
        image =
          resolvedImg.protocol === 'http:' || resolvedImg.protocol === 'https:'
            ? resolvedImg.toString()
            : '';
      } catch {
        image = '';
      }
    }

    return {
      url: rawUrl,
      domain,
      title,
      description,
      image: image.slice(0, 500),
      siteName,
    };
  } catch {
    return fallback;
  }
}

export async function extractAndFetchLinkPreviews(
  text: string
): Promise<LinkPreviewMeta[]> {
  const urls = extractUrlsFromText(text).slice(0, 3);
  if (urls.length === 0) return [];
  return Promise.all(urls.map((u) => fetchLinkPreview(u)));
}
