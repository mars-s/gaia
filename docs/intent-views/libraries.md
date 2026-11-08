# Library verification, 8 November 2026

The exact npm versions are pinned in package.json and package-lock.json. Registry metadata and the installed tarball LICENSE files were checked. Each of these licences permits free use, modification and commercial redistribution subject to retaining the licence notice.

| Package | Version | Licence | Primary source |
| --- | --- | --- | --- |
| skullet | 0.0.3 | MIT | https://github.com/lochie/skullet |
| torph | 0.1.3 | MIT | https://github.com/lochie/torph |
| web-haptics | 0.0.6 | MIT | https://github.com/lochie/web-haptics |
| papaparse | 5.7.0 | MIT | https://github.com/mholt/PapaParse |
| mammoth | 1.13.0 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js |
| unpdf | 2.1.0 | MIT, bundled PDF.js Apache-2.0 | https://github.com/unjs/unpdf |
| parse5 | 8.0.0 | MIT | https://github.com/inikulin/parse5 |
| jszip (test fixtures only) | 3.10.1 | MIT option under MIT OR GPL-3.0-or-later | https://github.com/Stuk/jszip |

The three craft libraries are pinned but not imported by the application yet. Their rendering fitness, reduced-motion behaviour, hidden-window operation, empty-label behaviour and actual gzipped chunk contribution remain unverified until B0 and the view gallery. No fallback was selected without that trial. Keep the plan's shape-matched skeleton fallback; Torph is for text, with NumberFlow for digits if needed. Haptics must only follow supported explicit actions, never progress.

The pinned unpdf bundle uses PDF.js types without the old `isEvalSupported` option. Gaia still passes `isEvalSupported: false`; no eval or Function constructor was found in its bundled `pdfjs.mjs`. Parsing runs only in a bounded worker and no document scripts, links or HTML are executed. PDF page rendering remains part of B4 and is not implemented here.
