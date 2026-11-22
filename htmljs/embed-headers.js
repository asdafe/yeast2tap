'use strict';

// grunt i18n writes dist/. This writes every wdoc header the active firmware includes.
// c_lcd_htm.h is not written: the classic frontend branch stops at #error.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const distDir = path.join(__dirname, 'dist');
const wdocDir = path.join(__dirname, '..', 'wdoc');

const languages = [
  'english',
  'chinese',
  'spanish',
  'portuguese-br',
  'slovak',
  'italian',
  'norwegian',
  'turkish'
];

const pages = [
  ['index_s.htm.gz', 'index_htm.h', 'data_index_htm_gz'],
  ['control_s.htm.gz', 'control_htm.h', 'control_htm_gz'],
  ['setup.htm.gz', 'setup_htm.h', 'setup_htm_gz'],
  ['logging.htm.gz', 'log_htm.h', 'logging_htm_gz'],
  ['gravity.htm.gz', 'gdc_htm.h', 'gravity_htm_gz'],
  ['gravity_e32.htm.gz', 'gdc_e32_htm.h', 'gravity_htm_gz'],
  ['config.htm.gz', 'config_htm.h', 'config_htm_gz'],
  ['pressure.htm.gz', 'pressure_htm.h', 'pressure_htm_gz'],
  ['scale.htm.gz', 'scale_htm.h', 'scale_htm_gz']
];

function headerText(buf, symbol, decl) {
  const kind = decl || 'const unsigned char';
  const lines = [];
  for (let i = 0; i < buf.length; i += 12) {
    const end = Math.min(i + 12, buf.length);
    const chunk = [];
    for (let j = i; j < end; j++) {
      chunk.push('0x' + buf[j].toString(16).padStart(2, '0'));
    }
    const last = end === buf.length;
    lines.push('  ' + chunk.join(', ') + (last ? '' : ','));
  }
  return kind + ' ' + symbol + '[] PROGMEM = {\n' +
    lines.join('\n') + '\n};\n' +
    'unsigned int ' + symbol + '_len = ' + buf.length + ';\n';
}

function gzipSource(srcPath, normalizeNewlines) {
  let buf = fs.readFileSync(srcPath);
  if (normalizeNewlines) {
    buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  }
  return zlib.gzipSync(buf, { level: 9 });
}

function writeGzipBuffer(buf, headerName, symbol, decl) {
  fs.writeFileSync(path.join(wdocDir, headerName), headerText(buf, symbol, decl));
  console.log(headerName + ' (' + buf.length + ' bytes)');
}

function writeHeader(gzPath, headerName, symbol) {
  if (!fs.existsSync(gzPath)) {
    throw new Error('missing gzip: ' + gzPath);
  }
  const buf = fs.readFileSync(gzPath);
  const headerPath = path.join(wdocDir, headerName);
  fs.writeFileSync(headerPath, headerText(buf, symbol));
  console.log(headerName + ' (' + buf.length + ' bytes)');
}

fs.mkdirSync(wdocDir, { recursive: true });

languages.forEach(function (lang) {
  pages.forEach(function (page) {
    writeHeader(
      path.join(distDir, lang, page[0]),
      lang + '_' + page[1],
      page[2]
    );
  });
});

// Scale is compiled for every language now (it used to be English-only).

writeGzipBuffer(
  gzipSource(path.join(__dirname, 'src/js/vendor/bwf.js'), false),
  'bwf_js.h',
  'bwf_js_gz'
);

writeGzipBuffer(
  gzipSource(path.join(__dirname, 'src/js/shared.js'), false),
  'shared_js.h',
  'shared_js_gz'
);

writeGzipBuffer(
  gzipSource(path.join(__dirname, 'src/js/num.js'), false),
  'num_js.h',
  'num_js_gz'
);

writeGzipBuffer(
  gzipSource(path.join(__dirname, 'src/js/dygraph-2.2.1/dygraph.min.js'), true),
  'dygraph_js.h',
  'dygraph_min_js_gz'
);

writeGzipBuffer(
  gzipSource(path.join(__dirname, 'src/embedded/edit.html'), false),
  'edit_html_gz.h',
  'edit_htm_gz',
  'const char'
);

const testcmdBody = fs.readFileSync(path.join(__dirname, 'src/embedded/testcmd.html'), 'utf8');
if (testcmdBody.indexOf(')END') !== -1) {
  throw new Error('testcmd.html contains the raw-string end marker');
}
fs.writeFileSync(
  path.join(wdocDir, 'testcmd_htm.h'),
  'const char data_testcmd_htm[] PROGMEM =\nR"END(' + testcmdBody + ')END";\n'
);
console.log('testcmd_htm.h (' + testcmdBody.length + ' chars)');
