# New Frontend for BPL

If you just want to test, try or use the new layout, please download the dist/ folder and upload the files to your BPL. If you are running the latest version with gzip-support, upload the .gz-files, otherwise the .htm-files

## Developing

One command rebuilds the pages and every header the firmware includes:

```
npm install
npm run embed
```

Run that from `htmljs/`. Do not run plain `grunt`. Plain `grunt` only watches files. `npx grunt build` does not write `wdoc/`. `npx grunt featureBuild` writes only these four English pages and does not write `wdoc/`: `index.htm`, `index_s.htm`, `setup.htm`, `scale.htm`.

Verified on this machine with Node.js 24.20.0. Packages pinned in `package.json`: `sass` 1.77.8 and `coffeescript` 2.7.0. Ruby is not required. Other Node versions were not verified.

## Do not run archive/

`archive/patch_*.js` and `archive/fix_*.js` are old scripts that rewrite `wdoc/` and `dist/` in place. They are kept for history. Do not run them. Change `src/` and run `npm run embed`.


## ToDo

- the "Waiting to Cool, Cooling, Heating"-text, etc on the STATUS could be color coded to match the colors that used to show under the graph
- unified header for all pages
- ~~add better mobile support~~
- ~~missing the heat/cool colors under the graph from the old one~~
- ~~legend jumps for long states~~