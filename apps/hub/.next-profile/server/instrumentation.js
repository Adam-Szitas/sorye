"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "instrumentation";
exports.ids = ["instrumentation"];
exports.modules = {

/***/ "(instrument)/./instrumentation.ts":
/*!****************************!*\
  !*** ./instrumentation.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   onRequestError: () => (/* binding */ onRequestError),\n/* harmony export */   register: () => (/* binding */ register)\n/* harmony export */ });\n/* harmony import */ var _sentry_nextjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @sentry/nextjs */ \"(instrument)/../../node_modules/.pnpm/@sentry+nextjs@10.75.1_@ope_f415a112eb08c85380df13e1e841e2d5/node_modules/@sentry/nextjs/build/cjs/index.server.js\");\n/* harmony import */ var _sentry_nextjs__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_sentry_nextjs__WEBPACK_IMPORTED_MODULE_0__);\n\nasync function register() {\n    if (true) {\n        const { initializeLlmControl } = await Promise.all(/*! import() */[__webpack_require__.e(\"vendor-chunks/zod@3.25.76\"), __webpack_require__.e(\"_instrument_lib_llm-control_ts\")]).then(__webpack_require__.bind(__webpack_require__, /*! ./lib/llm-control */ \"(instrument)/./lib/llm-control.ts\"));\n        await initializeLlmControl();\n    }\n    if ( true && process.env.SENTRY_DSN) {\n        await __webpack_require__.e(/*! import() */ \"_instrument_sentry_server_config_ts\").then(__webpack_require__.bind(__webpack_require__, /*! ./sentry.server.config */ \"(instrument)/./sentry.server.config.ts\"));\n    }\n    if (false) {}\n}\nconst onRequestError = _sentry_nextjs__WEBPACK_IMPORTED_MODULE_0__.captureRequestError;\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGluc3RydW1lbnQpLy4vaW5zdHJ1bWVudGF0aW9uLnRzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBeUM7QUFFbEMsZUFBZUM7SUFDcEIsSUFBSUMsSUFBcUMsRUFBRTtRQUN6QyxNQUFNLEVBQUVHLG9CQUFvQixFQUFFLEdBQUcsTUFBTSwyUEFBMkI7UUFDbEUsTUFBTUE7SUFDUjtJQUNBLElBQUlILEtBQXFDLElBQUlBLFFBQVFDLEdBQUcsQ0FBQ0csVUFBVSxFQUFFO1FBQ25FLE1BQU0sd01BQWdDO0lBQ3hDO0lBQ0EsSUFBSUosS0FBNkQsRUFBRSxFQUVsRTtBQUNIO0FBRU8sTUFBTUssaUJBQWlCUCwrREFBMEIsQ0FBQyIsInNvdXJjZXMiOlsiRDpcXHByb2plY3RzXFxzb3J5ZVxcYXBwc1xcaHViXFxpbnN0cnVtZW50YXRpb24udHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgU2VudHJ5IGZyb20gJ0BzZW50cnkvbmV4dGpzJztcclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWdpc3RlcigpIHtcclxuICBpZiAocHJvY2Vzcy5lbnYuTkVYVF9SVU5USU1FID09PSAnbm9kZWpzJykge1xyXG4gICAgY29uc3QgeyBpbml0aWFsaXplTGxtQ29udHJvbCB9ID0gYXdhaXQgaW1wb3J0KCcuL2xpYi9sbG0tY29udHJvbCcpO1xyXG4gICAgYXdhaXQgaW5pdGlhbGl6ZUxsbUNvbnRyb2woKTtcclxuICB9XHJcbiAgaWYgKHByb2Nlc3MuZW52Lk5FWFRfUlVOVElNRSA9PT0gJ25vZGVqcycgJiYgcHJvY2Vzcy5lbnYuU0VOVFJZX0RTTikge1xyXG4gICAgYXdhaXQgaW1wb3J0KCcuL3NlbnRyeS5zZXJ2ZXIuY29uZmlnJyk7XHJcbiAgfVxyXG4gIGlmIChwcm9jZXNzLmVudi5ORVhUX1JVTlRJTUUgPT09ICdlZGdlJyAmJiBwcm9jZXNzLmVudi5TRU5UUllfRFNOKSB7XHJcbiAgICBhd2FpdCBpbXBvcnQoJy4vc2VudHJ5LmVkZ2UuY29uZmlnJyk7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgY29uc3Qgb25SZXF1ZXN0RXJyb3IgPSBTZW50cnkuY2FwdHVyZVJlcXVlc3RFcnJvcjtcclxuIl0sIm5hbWVzIjpbIlNlbnRyeSIsInJlZ2lzdGVyIiwicHJvY2VzcyIsImVudiIsIk5FWFRfUlVOVElNRSIsImluaXRpYWxpemVMbG1Db250cm9sIiwiU0VOVFJZX0RTTiIsIm9uUmVxdWVzdEVycm9yIiwiY2FwdHVyZVJlcXVlc3RFcnJvciJdLCJpZ25vcmVMaXN0IjpbXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(instrument)/./instrumentation.ts\n");

/***/ }),

/***/ "child_process":
/*!********************************!*\
  !*** external "child_process" ***!
  \********************************/
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ "crypto":
/*!*************************!*\
  !*** external "crypto" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("crypto");

/***/ }),

/***/ "diagnostics_channel":
/*!**************************************!*\
  !*** external "diagnostics_channel" ***!
  \**************************************/
/***/ ((module) => {

module.exports = require("diagnostics_channel");

/***/ }),

/***/ "dns":
/*!**********************!*\
  !*** external "dns" ***!
  \**********************/
/***/ ((module) => {

module.exports = require("dns");

/***/ }),

/***/ "events":
/*!*************************!*\
  !*** external "events" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("events");

/***/ }),

/***/ "fs":
/*!*********************!*\
  !*** external "fs" ***!
  \*********************/
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ "fs/promises":
/*!******************************!*\
  !*** external "fs/promises" ***!
  \******************************/
/***/ ((module) => {

module.exports = require("fs/promises");

/***/ }),

/***/ "import-in-the-middle":
/*!***************************************!*\
  !*** external "import-in-the-middle" ***!
  \***************************************/
/***/ ((module) => {

module.exports = require("import-in-the-middle");

/***/ }),

/***/ "module":
/*!*************************!*\
  !*** external "module" ***!
  \*************************/
/***/ ((module) => {

module.exports = require("module");

/***/ }),

/***/ "node:async_hooks":
/*!***********************************!*\
  !*** external "node:async_hooks" ***!
  \***********************************/
/***/ ((module) => {

module.exports = require("node:async_hooks");

/***/ }),

/***/ "node:child_process":
/*!*************************************!*\
  !*** external "node:child_process" ***!
  \*************************************/
/***/ ((module) => {

module.exports = require("node:child_process");

/***/ }),

/***/ "node:diagnostics_channel":
/*!*******************************************!*\
  !*** external "node:diagnostics_channel" ***!
  \*******************************************/
/***/ ((module) => {

module.exports = require("node:diagnostics_channel");

/***/ }),

/***/ "node:events":
/*!******************************!*\
  !*** external "node:events" ***!
  \******************************/
/***/ ((module) => {

module.exports = require("node:events");

/***/ }),

/***/ "node:fs":
/*!**************************!*\
  !*** external "node:fs" ***!
  \**************************/
/***/ ((module) => {

module.exports = require("node:fs");

/***/ }),

/***/ "node:http":
/*!****************************!*\
  !*** external "node:http" ***!
  \****************************/
/***/ ((module) => {

module.exports = require("node:http");

/***/ }),

/***/ "node:https":
/*!*****************************!*\
  !*** external "node:https" ***!
  \*****************************/
/***/ ((module) => {

module.exports = require("node:https");

/***/ }),

/***/ "node:inspector":
/*!*********************************!*\
  !*** external "node:inspector" ***!
  \*********************************/
/***/ ((module) => {

module.exports = require("node:inspector");

/***/ }),

/***/ "node:module":
/*!******************************!*\
  !*** external "node:module" ***!
  \******************************/
/***/ ((module) => {

module.exports = require("node:module");

/***/ }),

/***/ "node:net":
/*!***************************!*\
  !*** external "node:net" ***!
  \***************************/
/***/ ((module) => {

module.exports = require("node:net");

/***/ }),

/***/ "node:os":
/*!**************************!*\
  !*** external "node:os" ***!
  \**************************/
/***/ ((module) => {

module.exports = require("node:os");

/***/ }),

/***/ "node:path":
/*!****************************!*\
  !*** external "node:path" ***!
  \****************************/
/***/ ((module) => {

module.exports = require("node:path");

/***/ }),

/***/ "node:readline":
/*!********************************!*\
  !*** external "node:readline" ***!
  \********************************/
/***/ ((module) => {

module.exports = require("node:readline");

/***/ }),

/***/ "node:stream":
/*!******************************!*\
  !*** external "node:stream" ***!
  \******************************/
/***/ ((module) => {

module.exports = require("node:stream");

/***/ }),

/***/ "node:tls":
/*!***************************!*\
  !*** external "node:tls" ***!
  \***************************/
/***/ ((module) => {

module.exports = require("node:tls");

/***/ }),

/***/ "node:tty":
/*!***************************!*\
  !*** external "node:tty" ***!
  \***************************/
/***/ ((module) => {

module.exports = require("node:tty");

/***/ }),

/***/ "node:url":
/*!***************************!*\
  !*** external "node:url" ***!
  \***************************/
/***/ ((module) => {

module.exports = require("node:url");

/***/ }),

/***/ "node:util":
/*!****************************!*\
  !*** external "node:util" ***!
  \****************************/
/***/ ((module) => {

module.exports = require("node:util");

/***/ }),

/***/ "node:worker_threads":
/*!**************************************!*\
  !*** external "node:worker_threads" ***!
  \**************************************/
/***/ ((module) => {

module.exports = require("node:worker_threads");

/***/ }),

/***/ "node:zlib":
/*!****************************!*\
  !*** external "node:zlib" ***!
  \****************************/
/***/ ((module) => {

module.exports = require("node:zlib");

/***/ }),

/***/ "path":
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("path");

/***/ }),

/***/ "perf_hooks":
/*!*****************************!*\
  !*** external "perf_hooks" ***!
  \*****************************/
/***/ ((module) => {

module.exports = require("perf_hooks");

/***/ }),

/***/ "require-in-the-middle":
/*!****************************************!*\
  !*** external "require-in-the-middle" ***!
  \****************************************/
/***/ ((module) => {

module.exports = require("require-in-the-middle");

/***/ }),

/***/ "url":
/*!**********************!*\
  !*** external "url" ***!
  \**********************/
/***/ ((module) => {

module.exports = require("url");

/***/ }),

/***/ "util":
/*!***********************!*\
  !*** external "util" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("util");

/***/ }),

/***/ "worker_threads":
/*!*********************************!*\
  !*** external "worker_threads" ***!
  \*********************************/
/***/ ((module) => {

module.exports = require("worker_threads");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("./webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/@sentry+core@10.75.1","vendor-chunks/@sentry+server-utils@10.75.1","vendor-chunks/@sentry+node@10.75.1_@opent_6716b945c57c00c7fd36605ce324583d","vendor-chunks/@sentry+nextjs@10.75.1_@ope_f415a112eb08c85380df13e1e841e2d5","vendor-chunks/@sentry+node-core@10.75.1_@_b9d1fc647fbbd9ad4b8405e412c65275","vendor-chunks/@opentelemetry+api@1.9.1","vendor-chunks/@opentelemetry+core@2.11.0_@opentelemetry+api@1.9.1","vendor-chunks/@opentelemetry+sdk-trace@2.11.0_@opentelemetry+api@1.9.1","vendor-chunks/@opentelemetry+instrumentat_1ad6a0a9759fd13d0c7cf454d56add20","vendor-chunks/@opentelemetry+api-logs@0.220.0","vendor-chunks/@opentelemetry+sdk-trace-ba_d050ffc90c19c039e2b5f22b4207510c","vendor-chunks/next@15.5.20_@opentelemetry_e953809d9472528807f1d9a6d0a2b229","vendor-chunks/@opentelemetry+resources@2.11.0_@opentelemetry+api@1.9.1","vendor-chunks/@sentry+conventions@0.16.0","vendor-chunks/@sentry+opentelemetry@10.75_7442db4c48ce0751b44dcbc343dc80dd","vendor-chunks/@swc+helpers@0.5.15","vendor-chunks/stacktrace-parser@0.1.11","vendor-chunks/@opentelemetry+semantic-conventions@1.43.0"], () => (__webpack_exec__("(instrument)/./instrumentation.ts")));
module.exports = __webpack_exports__;

})();