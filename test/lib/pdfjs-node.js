// The vendored pdf.js, configured for Node (fake worker from the vendored worker file).
import * as pdfjs from '../../vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
export default pdfjs;
