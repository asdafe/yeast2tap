import fs from 'node:fs';
import path from 'node:path';

const ARRAY_RE = /const\s+unsigned\s+char\s+(\w+)\s*\[\s*\]\s*PROGMEM\s*=\s*\{([\s\S]*?)\}\s*;/m;

/**
 * Parse one generated wdoc header.
 * Returns { bytes, declaredLength, symbol }.
 */
export function parseHeader(headerPath) {
  let text;
  try {
    text = fs.readFileSync(headerPath, 'utf8');
  } catch (error) {
    throw new Error(`cannot read embedded header ${headerPath}: ${error.message}`);
  }

  const match = text.match(ARRAY_RE);
  if (!match) {
    throw new Error(`malformed embedded header ${headerPath}: no PROGMEM byte array`);
  }

  const [, symbol, body] = match;
  const tokens = body.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`malformed embedded header ${headerPath}: empty byte array`);
  }

  const bytes = Buffer.alloc(tokens.length);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!/^0[xX][0-9a-fA-F]{1,2}$/.test(token)) {
      throw new Error(
        `malformed embedded header ${headerPath}: invalid byte token "${token}"`,
      );
    }
    bytes[i] = Number.parseInt(token.slice(2), 16);
  }

  const lengthMatch = text.match(
    new RegExp(`unsigned\\s+int\\s+${symbol}_len\\s*=\\s*(\\d+)\\s*;`),
  );
  if (!lengthMatch) {
    throw new Error(`malformed embedded header ${headerPath}: missing ${symbol}_len`);
  }

  const declaredLength = Number(lengthMatch[1]);
  if (bytes.length !== declaredLength) {
    throw new Error(
      `malformed embedded header ${headerPath}: ${symbol}_len=${declaredLength} but ${bytes.length} bytes`,
    );
  }

  return { bytes, declaredLength, symbol };
}

// Mirrors src/EmbeddedFiles.cpp for the esp32 English build.
export const ROUTE_MAP = {
  '/': 'english_index_htm.h',
  '/index.htm': 'english_index_htm.h',
  '/control.htm': 'english_control_htm.h',
  '/setup.htm': 'english_setup_htm.h',
  '/logging.htm': 'english_log_htm.h',
  '/gravity.htm': 'english_gdc_e32_htm.h',
  '/config.htm': 'english_config_htm.h',
  '/pressure.htm': 'english_pressure_htm.h',
  '/scale.htm': 'english_scale_htm.h',
  '/shared.js': 'shared_js.h',
  '/bwf.js': 'bwf_js.h',
  '/num.js': 'num_js.h',
  '/dygraph.min.js': 'dygraph_js.h',
};

export function languageRouteMap(language) {
  if (language === 'english') return ROUTE_MAP;
  const map = { ...ROUTE_MAP };
  const prefix = language;
  for (const route of [
    '/',
    '/index.htm',
    '/control.htm',
    '/setup.htm',
    '/logging.htm',
    '/gravity.htm',
    '/config.htm',
    '/pressure.htm',
    '/scale.htm',
  ]) {
    const english = ROUTE_MAP[route];
    if (english.startsWith('english_')) {
      map[route] = english.replace(/^english_/, `${prefix}_`);
    }
  }
  return map;
}

function mimeFor(route) {
  if (route.endsWith('.js')) return 'application/javascript';
  if (route.endsWith('.htm') || route === '/') return 'text/html';
  return 'application/octet-stream';
}

export function loadEmbeddedAssets(repoRoot, language = 'english') {
  const map = languageRouteMap(language);
  const assets = new Map();

  for (const [route, headerName] of Object.entries(map)) {
    const headerPath = path.join(repoRoot, 'wdoc', headerName);
    const { bytes, declaredLength } = parseHeader(headerPath);
    assets.set(route, {
      bytes,
      declaredLength,
      mime: mimeFor(route),
      headerPath,
    });
  }

  return assets;
}
