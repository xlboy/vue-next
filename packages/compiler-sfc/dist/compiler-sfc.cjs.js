'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var sourceMap = require('source-map');
var parser = require('@babel/parser');
var estreeWalker = require('estree-walker');
var postcss = require('postcss');
var hash = require('hash-sum');
var path = require('path');
var url = require('url');
var selectorParser = require('postcss-selector-parser');
var merge = require('merge-source-map');
var MagicString = require('magic-string');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e['default'] : e; }

var postcss__default = /*#__PURE__*/_interopDefaultLegacy(postcss);
var hash__default = /*#__PURE__*/_interopDefaultLegacy(hash);
var path__default = /*#__PURE__*/_interopDefaultLegacy(path);
var selectorParser__default = /*#__PURE__*/_interopDefaultLegacy(selectorParser);
var merge__default = /*#__PURE__*/_interopDefaultLegacy(merge);
var MagicString__default = /*#__PURE__*/_interopDefaultLegacy(MagicString);

/**
 * Make a map and return a function for checking if a key
 * is in that map.
 * IMPORTANT: all calls of this function must be prefixed with
 * \/\*#\_\_PURE\_\_\*\/
 * So that rollup can tree-shake them if necessary.
 */
function makeMap(str, expectsLowerCase) {
    const map = Object.create(null);
    const list = str.split(',');
    for (let i = 0; i < list.length; i++) {
        map[list[i]] = true;
    }
    return expectsLowerCase ? val => !!map[val.toLowerCase()] : val => !!map[val];
}

/**
 * dev only flag -> name mapping
 */
const PatchFlagNames = {
    [1 /* TEXT */]: `TEXT`,
    [2 /* CLASS */]: `CLASS`,
    [4 /* STYLE */]: `STYLE`,
    [8 /* PROPS */]: `PROPS`,
    [16 /* FULL_PROPS */]: `FULL_PROPS`,
    [32 /* HYDRATE_EVENTS */]: `HYDRATE_EVENTS`,
    [64 /* STABLE_FRAGMENT */]: `STABLE_FRAGMENT`,
    [128 /* KEYED_FRAGMENT */]: `KEYED_FRAGMENT`,
    [256 /* UNKEYED_FRAGMENT */]: `UNKEYED_FRAGMENT`,
    [512 /* NEED_PATCH */]: `NEED_PATCH`,
    [1024 /* DYNAMIC_SLOTS */]: `DYNAMIC_SLOTS`,
    [2048 /* DEV_ROOT_FRAGMENT */]: `DEV_ROOT_FRAGMENT`,
    [-1 /* HOISTED */]: `HOISTED`,
    [-2 /* BAIL */]: `BAIL`
};

/**
 * Dev only
 */
const slotFlagsText = {
    [1 /* STABLE */]: 'STABLE',
    [2 /* DYNAMIC */]: 'DYNAMIC',
    [3 /* FORWARDED */]: 'FORWARDED'
};

const GLOBALS_WHITE_LISTED = 'Infinity,undefined,NaN,isFinite,isNaN,parseFloat,parseInt,decodeURI,' +
    'decodeURIComponent,encodeURI,encodeURIComponent,Math,Number,Date,Array,' +
    'Object,Boolean,String,RegExp,Map,Set,JSON,Intl';
const isGloballyWhitelisted = /*#__PURE__*/ makeMap(GLOBALS_WHITE_LISTED);

const range = 2;
function generateCodeFrame(source, start = 0, end = source.length) {
    const lines = source.split(/\r?\n/);
    let count = 0;
    const res = [];
    for (let i = 0; i < lines.length; i++) {
        count += lines[i].length + 1;
        if (count >= start) {
            for (let j = i - range; j <= i + range || end > count; j++) {
                if (j < 0 || j >= lines.length)
                    continue;
                const line = j + 1;
                res.push(`${line}${' '.repeat(Math.max(3 - String(line).length, 0))}|  ${lines[j]}`);
                const lineLength = lines[j].length;
                if (j === i) {
                    // push underline
                    const pad = start - (count - lineLength) + 1;
                    const length = Math.max(1, end > count ? lineLength - pad : end - start);
                    res.push(`   |  ` + ' '.repeat(pad) + '^'.repeat(length));
                }
                else if (j > i) {
                    if (end > count) {
                        const length = Math.max(Math.min(end - count, lineLength), 1);
                        res.push(`   |  ` + '^'.repeat(length));
                    }
                    count += lineLength + 1;
                }
            }
            break;
        }
    }
    return res.join('\n');
}

/**
 * On the client we only need to offer special cases for boolean attributes that
 * have different names from their corresponding dom properties:
 * - itemscope -> N/A
 * - allowfullscreen -> allowFullscreen
 * - formnovalidate -> formNoValidate
 * - ismap -> isMap
 * - nomodule -> noModule
 * - novalidate -> noValidate
 * - readonly -> readOnly
 */
const specialBooleanAttrs = `itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly`;
/**
 * The full list is needed during SSR to produce the correct initial markup.
 */
const isBooleanAttr = /*#__PURE__*/ makeMap(specialBooleanAttrs +
    `,async,autofocus,autoplay,controls,default,defer,disabled,hidden,` +
    `loop,open,required,reversed,scoped,seamless,` +
    `checked,muted,multiple,selected`);
const unsafeAttrCharRE = /[>/="'\u0009\u000a\u000c\u0020]/;
const attrValidationCache = {};
function isSSRSafeAttrName(name) {
    if (attrValidationCache.hasOwnProperty(name)) {
        return attrValidationCache[name];
    }
    const isUnsafe = unsafeAttrCharRE.test(name);
    if (isUnsafe) {
        console.error(`unsafe attribute name: ${name}`);
    }
    return (attrValidationCache[name] = !isUnsafe);
}
const propsToAttrMap = {
    acceptCharset: 'accept-charset',
    className: 'class',
    htmlFor: 'for',
    httpEquiv: 'http-equiv'
};
/**
 * CSS properties that accept plain numbers
 */
const isNoUnitNumericStyleProp = /*#__PURE__*/ makeMap(`animation-iteration-count,border-image-outset,border-image-slice,` +
    `border-image-width,box-flex,box-flex-group,box-ordinal-group,column-count,` +
    `columns,flex,flex-grow,flex-positive,flex-shrink,flex-negative,flex-order,` +
    `grid-row,grid-row-end,grid-row-span,grid-row-start,grid-column,` +
    `grid-column-end,grid-column-span,grid-column-start,font-weight,line-clamp,` +
    `line-height,opacity,order,orphans,tab-size,widows,z-index,zoom,` +
    // SVG
    `fill-opacity,flood-opacity,stop-opacity,stroke-dasharray,stroke-dashoffset,` +
    `stroke-miterlimit,stroke-opacity,stroke-width`);
/**
 * Known attributes, this is used for stringification of runtime static nodes
 * so that we don't stringify bindings that cannot be set from HTML.
 * Don't also forget to allow `data-*` and `aria-*`!
 * Generated from https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes
 */
const isKnownAttr = /*#__PURE__*/ makeMap(`accept,accept-charset,accesskey,action,align,allow,alt,async,` +
    `autocapitalize,autocomplete,autofocus,autoplay,background,bgcolor,` +
    `border,buffered,capture,challenge,charset,checked,cite,class,code,` +
    `codebase,color,cols,colspan,content,contenteditable,contextmenu,controls,` +
    `coords,crossorigin,csp,data,datetime,decoding,default,defer,dir,dirname,` +
    `disabled,download,draggable,dropzone,enctype,enterkeyhint,for,form,` +
    `formaction,formenctype,formmethod,formnovalidate,formtarget,headers,` +
    `height,hidden,high,href,hreflang,http-equiv,icon,id,importance,integrity,` +
    `ismap,itemprop,keytype,kind,label,lang,language,loading,list,loop,low,` +
    `manifest,max,maxlength,minlength,media,min,multiple,muted,name,novalidate,` +
    `open,optimum,pattern,ping,placeholder,poster,preload,radiogroup,readonly,` +
    `referrerpolicy,rel,required,reversed,rows,rowspan,sandbox,scope,scoped,` +
    `selected,shape,size,sizes,slot,span,spellcheck,src,srcdoc,srclang,srcset,` +
    `start,step,style,summary,tabindex,target,title,translate,type,usemap,` +
    `value,width,wrap`);

function normalizeStyle(value) {
    if (isArray(value)) {
        const res = {};
        for (let i = 0; i < value.length; i++) {
            const item = value[i];
            const normalized = normalizeStyle(isString(item) ? parseStringStyle(item) : item);
            if (normalized) {
                for (const key in normalized) {
                    res[key] = normalized[key];
                }
            }
        }
        return res;
    }
    else if (isObject(value)) {
        return value;
    }
}
const listDelimiterRE = /;(?![^(]*\))/g;
const propertyDelimiterRE = /:(.+)/;
function parseStringStyle(cssText) {
    const ret = {};
    cssText.split(listDelimiterRE).forEach(item => {
        if (item) {
            const tmp = item.split(propertyDelimiterRE);
            tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim());
        }
    });
    return ret;
}
function stringifyStyle(styles) {
    let ret = '';
    if (!styles) {
        return ret;
    }
    for (const key in styles) {
        const value = styles[key];
        const normalizedKey = key.startsWith(`--`) ? key : hyphenate(key);
        if (isString(value) ||
            (typeof value === 'number' && isNoUnitNumericStyleProp(normalizedKey))) {
            // only render valid values
            ret += `${normalizedKey}:${value};`;
        }
    }
    return ret;
}
function normalizeClass(value) {
    let res = '';
    if (isString(value)) {
        res = value;
    }
    else if (isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            res += normalizeClass(value[i]) + ' ';
        }
    }
    else if (isObject(value)) {
        for (const name in value) {
            if (value[name]) {
                res += name + ' ';
            }
        }
    }
    return res.trim();
}

// These tag configs are shared between compiler-dom and runtime-dom, so they
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element
const HTML_TAGS = 'html,body,base,head,link,meta,style,title,address,article,aside,footer,' +
    'header,h1,h2,h3,h4,h5,h6,hgroup,nav,section,div,dd,dl,dt,figcaption,' +
    'figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,' +
    'data,dfn,em,i,kbd,mark,q,rp,rt,rtc,ruby,s,samp,small,span,strong,sub,sup,' +
    'time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,' +
    'canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,' +
    'th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,' +
    'option,output,progress,select,textarea,details,dialog,menu,' +
    'summary,template,blockquote,iframe,tfoot';
// https://developer.mozilla.org/en-US/docs/Web/SVG/Element
const SVG_TAGS = 'svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,' +
    'defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,' +
    'feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,' +
    'feDistanceLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,' +
    'feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,' +
    'fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,' +
    'foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,' +
    'mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,' +
    'polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,' +
    'text,textPath,title,tspan,unknown,use,view';
const VOID_TAGS = 'area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr';
const isHTMLTag = /*#__PURE__*/ makeMap(HTML_TAGS);
const isSVGTag = /*#__PURE__*/ makeMap(SVG_TAGS);
const isVoidTag = /*#__PURE__*/ makeMap(VOID_TAGS);

const escapeRE = /["'&<>]/;
function escapeHtml(string) {
    const str = '' + string;
    const match = escapeRE.exec(str);
    if (!match) {
        return str;
    }
    let html = '';
    let escaped;
    let index;
    let lastIndex = 0;
    for (index = match.index; index < str.length; index++) {
        switch (str.charCodeAt(index)) {
            case 34: // "
                escaped = '&quot;';
                break;
            case 38: // &
                escaped = '&amp;';
                break;
            case 39: // '
                escaped = '&#39;';
                break;
            case 60: // <
                escaped = '&lt;';
                break;
            case 62: // >
                escaped = '&gt;';
                break;
            default:
                continue;
        }
        if (lastIndex !== index) {
            html += str.substring(lastIndex, index);
        }
        lastIndex = index + 1;
        html += escaped;
    }
    return lastIndex !== index ? html + str.substring(lastIndex, index) : html;
}

/**
 * For converting {{ interpolation }} values to displayed strings.
 * @private
 */
const toDisplayString = (val) => {
    return val == null
        ? ''
        : isObject(val)
            ? JSON.stringify(val, replacer, 2)
            : String(val);
};
const replacer = (_key, val) => {
    if (isMap(val)) {
        return {
            [`Map(${val.size})`]: [...val.entries()].reduce((entries, [key, val]) => {
                entries[`${key} =>`] = val;
                return entries;
            }, {})
        };
    }
    else if (isSet(val)) {
        return {
            [`Set(${val.size})`]: [...val.values()]
        };
    }
    else if (isObject(val) && !isArray(val) && !isPlainObject(val)) {
        return String(val);
    }
    return val;
};

/**
 * List of @babel/parser plugins that are used for template expression
 * transforms and SFC script transforms. By default we enable proposals slated
 * for ES2020. This will need to be updated as the spec moves forward.
 * Full list at https://babeljs.io/docs/en/next/babel-parser#plugins
 */
const babelParserDefaultPlugins = [
    'bigInt',
    'optionalChaining',
    'nullishCoalescingOperator'
];
const EMPTY_OBJ =  Object.freeze({})
    ;
const EMPTY_ARR =  Object.freeze([]) ;
const NOOP = () => { };
/**
 * Always return false.
 */
const NO = () => false;
const onRE = /^on[^a-z]/;
const isOn = (key) => onRE.test(key);
const extend = Object.assign;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const hasOwn = (val, key) => hasOwnProperty.call(val, key);
const isArray = Array.isArray;
const isMap = (val) => toTypeString(val) === '[object Map]';
const isSet = (val) => toTypeString(val) === '[object Set]';
const isFunction = (val) => typeof val === 'function';
const isString = (val) => typeof val === 'string';
const isSymbol = (val) => typeof val === 'symbol';
const isObject = (val) => val !== null && typeof val === 'object';
const objectToString = Object.prototype.toString;
const toTypeString = (value) => objectToString.call(value);
const isPlainObject = (val) => toTypeString(val) === '[object Object]';
const isReservedProp = /*#__PURE__*/ makeMap(
// the leading comma is intentional so empty string "" is also included
',key,ref,' +
    'onVnodeBeforeMount,onVnodeMounted,' +
    'onVnodeBeforeUpdate,onVnodeUpdated,' +
    'onVnodeBeforeUnmount,onVnodeUnmounted');
const cacheStringFunction = (fn) => {
    const cache = Object.create(null);
    return ((str) => {
        const hit = cache[str];
        return hit || (cache[str] = fn(str));
    });
};
const camelizeRE = /-(\w)/g;
/**
 * @private
 */
const camelize = cacheStringFunction((str) => {
    return str.replace(camelizeRE, (_, c) => (c ? c.toUpperCase() : ''));
});
const hyphenateRE = /\B([A-Z])/g;
/**
 * @private
 */
const hyphenate = cacheStringFunction((str) => str.replace(hyphenateRE, '-$1').toLowerCase());
/**
 * @private
 */
const capitalize = cacheStringFunction((str) => str.charAt(0).toUpperCase() + str.slice(1));
/**
 * @private
 */
const toHandlerKey = cacheStringFunction((str) => (str ? `on${capitalize(str)}` : ``));

function defaultOnError(error) {
    throw error;
}
function createCompilerError(code, loc, messages, additionalMessage) {
    const msg =  (messages || errorMessages)[code] + (additionalMessage || ``)
        ;
    const error = new SyntaxError(String(msg));
    error.code = code;
    error.loc = loc;
    return error;
}
const errorMessages = {
    // parse errors
    [0 /* ABRUPT_CLOSING_OF_EMPTY_COMMENT */]: 'Illegal comment.',
    [1 /* CDATA_IN_HTML_CONTENT */]: 'CDATA section is allowed only in XML context.',
    [2 /* DUPLICATE_ATTRIBUTE */]: 'Duplicate attribute.',
    [3 /* END_TAG_WITH_ATTRIBUTES */]: 'End tag cannot have attributes.',
    [4 /* END_TAG_WITH_TRAILING_SOLIDUS */]: "Illegal '/' in tags.",
    [5 /* EOF_BEFORE_TAG_NAME */]: 'Unexpected EOF in tag.',
    [6 /* EOF_IN_CDATA */]: 'Unexpected EOF in CDATA section.',
    [7 /* EOF_IN_COMMENT */]: 'Unexpected EOF in comment.',
    [8 /* EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT */]: 'Unexpected EOF in script.',
    [9 /* EOF_IN_TAG */]: 'Unexpected EOF in tag.',
    [10 /* INCORRECTLY_CLOSED_COMMENT */]: 'Incorrectly closed comment.',
    [11 /* INCORRECTLY_OPENED_COMMENT */]: 'Incorrectly opened comment.',
    [12 /* INVALID_FIRST_CHARACTER_OF_TAG_NAME */]: "Illegal tag name. Use '&lt;' to print '<'.",
    [13 /* MISSING_ATTRIBUTE_VALUE */]: 'Attribute value was expected.',
    [14 /* MISSING_END_TAG_NAME */]: 'End tag name was expected.',
    [15 /* MISSING_WHITESPACE_BETWEEN_ATTRIBUTES */]: 'Whitespace was expected.',
    [16 /* NESTED_COMMENT */]: "Unexpected '<!--' in comment.",
    [17 /* UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME */]: 'Attribute name cannot contain U+0022 ("), U+0027 (\'), and U+003C (<).',
    [18 /* UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE */]: 'Unquoted attribute value cannot contain U+0022 ("), U+0027 (\'), U+003C (<), U+003D (=), and U+0060 (`).',
    [19 /* UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME */]: "Attribute name cannot start with '='.",
    [21 /* UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME */]: "'<?' is allowed only in XML context.",
    [22 /* UNEXPECTED_SOLIDUS_IN_TAG */]: "Illegal '/' in tags.",
    // Vue-specific parse errors
    [23 /* X_INVALID_END_TAG */]: 'Invalid end tag.',
    [24 /* X_MISSING_END_TAG */]: 'Element is missing end tag.',
    [25 /* X_MISSING_INTERPOLATION_END */]: 'Interpolation end sign was not found.',
    [26 /* X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END */]: 'End bracket for dynamic directive argument was not found. ' +
        'Note that dynamic directive argument cannot contain spaces.',
    // transform errors
    [27 /* X_V_IF_NO_EXPRESSION */]: `v-if/v-else-if is missing expression.`,
    [28 /* X_V_IF_SAME_KEY */]: `v-if/else branches must use unique keys.`,
    [29 /* X_V_ELSE_NO_ADJACENT_IF */]: `v-else/v-else-if has no adjacent v-if.`,
    [30 /* X_V_FOR_NO_EXPRESSION */]: `v-for is missing expression.`,
    [31 /* X_V_FOR_MALFORMED_EXPRESSION */]: `v-for has invalid expression.`,
    [32 /* X_V_FOR_TEMPLATE_KEY_PLACEMENT */]: `<template v-for> key should be placed on the <template> tag.`,
    [33 /* X_V_BIND_NO_EXPRESSION */]: `v-bind is missing expression.`,
    [34 /* X_V_ON_NO_EXPRESSION */]: `v-on is missing expression.`,
    [35 /* X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET */]: `Unexpected custom directive on <slot> outlet.`,
    [36 /* X_V_SLOT_MIXED_SLOT_USAGE */]: `Mixed v-slot usage on both the component and nested <template>.` +
        `When there are multiple named slots, all slots should use <template> ` +
        `syntax to avoid scope ambiguity.`,
    [37 /* X_V_SLOT_DUPLICATE_SLOT_NAMES */]: `Duplicate slot names found. `,
    [38 /* X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN */]: `Extraneous children found when component already has explicitly named ` +
        `default slot. These children will be ignored.`,
    [39 /* X_V_SLOT_MISPLACED */]: `v-slot can only be used on components or <template> tags.`,
    [40 /* X_V_MODEL_NO_EXPRESSION */]: `v-model is missing expression.`,
    [41 /* X_V_MODEL_MALFORMED_EXPRESSION */]: `v-model value must be a valid JavaScript member expression.`,
    [42 /* X_V_MODEL_ON_SCOPE_VARIABLE */]: `v-model cannot be used on v-for or v-slot scope variables because they are not writable.`,
    [43 /* X_INVALID_EXPRESSION */]: `Error parsing JavaScript expression: `,
    [44 /* X_KEEP_ALIVE_INVALID_CHILDREN */]: `<KeepAlive> expects exactly one child component.`,
    // generic errors
    [45 /* X_PREFIX_ID_NOT_SUPPORTED */]: `"prefixIdentifiers" option is not supported in this build of compiler.`,
    [46 /* X_MODULE_MODE_NOT_SUPPORTED */]: `ES module mode is not supported in this build of compiler.`,
    [47 /* X_CACHE_HANDLER_NOT_SUPPORTED */]: `"cacheHandlers" option is only supported when the "prefixIdentifiers" option is enabled.`,
    [48 /* X_SCOPE_ID_NOT_SUPPORTED */]: `"scopeId" option is only supported in module mode.`
};

const FRAGMENT = Symbol( `Fragment` );
const TELEPORT = Symbol( `Teleport` );
const SUSPENSE = Symbol( `Suspense` );
const KEEP_ALIVE = Symbol( `KeepAlive` );
const BASE_TRANSITION = Symbol( `BaseTransition` );
const OPEN_BLOCK = Symbol( `openBlock` );
const CREATE_BLOCK = Symbol( `createBlock` );
const CREATE_VNODE = Symbol( `createVNode` );
const CREATE_COMMENT = Symbol( `createCommentVNode` );
const CREATE_TEXT = Symbol( `createTextVNode` );
const CREATE_STATIC = Symbol( `createStaticVNode` );
const RESOLVE_COMPONENT = Symbol( `resolveComponent` );
const RESOLVE_DYNAMIC_COMPONENT = Symbol( `resolveDynamicComponent` );
const RESOLVE_DIRECTIVE = Symbol( `resolveDirective` );
const WITH_DIRECTIVES = Symbol( `withDirectives` );
const RENDER_LIST = Symbol( `renderList` );
const RENDER_SLOT = Symbol( `renderSlot` );
const CREATE_SLOTS = Symbol( `createSlots` );
const TO_DISPLAY_STRING = Symbol( `toDisplayString` );
const MERGE_PROPS = Symbol( `mergeProps` );
const TO_HANDLERS = Symbol( `toHandlers` );
const CAMELIZE = Symbol( `camelize` );
const CAPITALIZE = Symbol( `capitalize` );
const TO_HANDLER_KEY = Symbol( `toHandlerKey` );
const SET_BLOCK_TRACKING = Symbol( `setBlockTracking` );
const PUSH_SCOPE_ID = Symbol( `pushScopeId` );
const POP_SCOPE_ID = Symbol( `popScopeId` );
const WITH_SCOPE_ID = Symbol( `withScopeId` );
const WITH_CTX = Symbol( `withCtx` );
const UNREF = Symbol( `unref` );
const IS_REF = Symbol( `isRef` );
// Name mapping for runtime helpers that need to be imported from 'vue' in
// generated code. Make sure these are correctly exported in the runtime!
// Using `any` here because TS doesn't allow symbols as index type.
const helperNameMap = {
    [FRAGMENT]: `Fragment`,
    [TELEPORT]: `Teleport`,
    [SUSPENSE]: `Suspense`,
    [KEEP_ALIVE]: `KeepAlive`,
    [BASE_TRANSITION]: `BaseTransition`,
    [OPEN_BLOCK]: `openBlock`,
    [CREATE_BLOCK]: `createBlock`,
    [CREATE_VNODE]: `createVNode`,
    [CREATE_COMMENT]: `createCommentVNode`,
    [CREATE_TEXT]: `createTextVNode`,
    [CREATE_STATIC]: `createStaticVNode`,
    [RESOLVE_COMPONENT]: `resolveComponent`,
    [RESOLVE_DYNAMIC_COMPONENT]: `resolveDynamicComponent`,
    [RESOLVE_DIRECTIVE]: `resolveDirective`,
    [WITH_DIRECTIVES]: `withDirectives`,
    [RENDER_LIST]: `renderList`,
    [RENDER_SLOT]: `renderSlot`,
    [CREATE_SLOTS]: `createSlots`,
    [TO_DISPLAY_STRING]: `toDisplayString`,
    [MERGE_PROPS]: `mergeProps`,
    [TO_HANDLERS]: `toHandlers`,
    [CAMELIZE]: `camelize`,
    [CAPITALIZE]: `capitalize`,
    [TO_HANDLER_KEY]: `toHandlerKey`,
    [SET_BLOCK_TRACKING]: `setBlockTracking`,
    [PUSH_SCOPE_ID]: `pushScopeId`,
    [POP_SCOPE_ID]: `popScopeId`,
    [WITH_SCOPE_ID]: `withScopeId`,
    [WITH_CTX]: `withCtx`,
    [UNREF]: `unref`,
    [IS_REF]: `isRef`
};
function registerRuntimeHelpers(helpers) {
    Object.getOwnPropertySymbols(helpers).forEach(s => {
        helperNameMap[s] = helpers[s];
    });
}

// AST Utilities ---------------------------------------------------------------
// Some expressions, e.g. sequence and conditional expressions, are never
// associated with template nodes, so their source locations are just a stub.
// Container types like CompoundExpression also don't need a real location.
const locStub = {
    source: '',
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 }
};
function createRoot(children, loc = locStub) {
    return {
        type: 0 /* ROOT */,
        children,
        helpers: [],
        components: [],
        directives: [],
        hoists: [],
        imports: [],
        cached: 0,
        temps: 0,
        codegenNode: undefined,
        loc
    };
}
function createVNodeCall(context, tag, props, children, patchFlag, dynamicProps, directives, isBlock = false, disableTracking = false, loc = locStub) {
    if (context) {
        if (isBlock) {
            context.helper(OPEN_BLOCK);
            context.helper(CREATE_BLOCK);
        }
        else {
            context.helper(CREATE_VNODE);
        }
        if (directives) {
            context.helper(WITH_DIRECTIVES);
        }
    }
    return {
        type: 13 /* VNODE_CALL */,
        tag,
        props,
        children,
        patchFlag,
        dynamicProps,
        directives,
        isBlock,
        disableTracking,
        loc
    };
}
function createArrayExpression(elements, loc = locStub) {
    return {
        type: 17 /* JS_ARRAY_EXPRESSION */,
        loc,
        elements
    };
}
function createObjectExpression(properties, loc = locStub) {
    return {
        type: 15 /* JS_OBJECT_EXPRESSION */,
        loc,
        properties
    };
}
function createObjectProperty(key, value) {
    return {
        type: 16 /* JS_PROPERTY */,
        loc: locStub,
        key: isString(key) ? createSimpleExpression(key, true) : key,
        value
    };
}
function createSimpleExpression(content, isStatic, loc = locStub, constType = 0 /* NOT_CONSTANT */) {
    return {
        type: 4 /* SIMPLE_EXPRESSION */,
        loc,
        content,
        isStatic,
        constType: isStatic ? 3 /* CAN_STRINGIFY */ : constType
    };
}
function createInterpolation(content, loc) {
    return {
        type: 5 /* INTERPOLATION */,
        loc,
        content: isString(content)
            ? createSimpleExpression(content, false, loc)
            : content
    };
}
function createCompoundExpression(children, loc = locStub) {
    return {
        type: 8 /* COMPOUND_EXPRESSION */,
        loc,
        children
    };
}
function createCallExpression(callee, args = [], loc = locStub) {
    return {
        type: 14 /* JS_CALL_EXPRESSION */,
        loc,
        callee,
        arguments: args
    };
}
function createFunctionExpression(params, returns = undefined, newline = false, isSlot = false, loc = locStub) {
    return {
        type: 18 /* JS_FUNCTION_EXPRESSION */,
        params,
        returns,
        newline,
        isSlot,
        loc
    };
}
function createConditionalExpression(test, consequent, alternate, newline = true) {
    return {
        type: 19 /* JS_CONDITIONAL_EXPRESSION */,
        test,
        consequent,
        alternate,
        newline,
        loc: locStub
    };
}
function createCacheExpression(index, value, isVNode = false) {
    return {
        type: 20 /* JS_CACHE_EXPRESSION */,
        index,
        value,
        isVNode,
        loc: locStub
    };
}
function createBlockStatement(body) {
    return {
        type: 21 /* JS_BLOCK_STATEMENT */,
        body,
        loc: locStub
    };
}
function createTemplateLiteral(elements) {
    return {
        type: 22 /* JS_TEMPLATE_LITERAL */,
        elements,
        loc: locStub
    };
}
function createIfStatement(test, consequent, alternate) {
    return {
        type: 23 /* JS_IF_STATEMENT */,
        test,
        consequent,
        alternate,
        loc: locStub
    };
}
function createAssignmentExpression(left, right) {
    return {
        type: 24 /* JS_ASSIGNMENT_EXPRESSION */,
        left,
        right,
        loc: locStub
    };
}
function createSequenceExpression(expressions) {
    return {
        type: 25 /* JS_SEQUENCE_EXPRESSION */,
        expressions,
        loc: locStub
    };
}
function createReturnStatement(returns) {
    return {
        type: 26 /* JS_RETURN_STATEMENT */,
        returns,
        loc: locStub
    };
}

const isStaticExp = (p) => p.type === 4 /* SIMPLE_EXPRESSION */ && p.isStatic;
const isBuiltInType = (tag, expected) => tag === expected || tag === hyphenate(expected);
function isCoreComponent(tag) {
    if (isBuiltInType(tag, 'Teleport')) {
        return TELEPORT;
    }
    else if (isBuiltInType(tag, 'Suspense')) {
        return SUSPENSE;
    }
    else if (isBuiltInType(tag, 'KeepAlive')) {
        return KEEP_ALIVE;
    }
    else if (isBuiltInType(tag, 'BaseTransition')) {
        return BASE_TRANSITION;
    }
}
const nonIdentifierRE = /^\d|[^\$\w]/;
const isSimpleIdentifier = (name) => !nonIdentifierRE.test(name);
const memberExpRE = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])*$/;
const isMemberExpression = (path) => {
    if (!path)
        return false;
    return memberExpRE.test(path.trim());
};
function getInnerRange(loc, offset, length) {
    const source = loc.source.substr(offset, length);
    const newLoc = {
        source,
        start: advancePositionWithClone(loc.start, loc.source, offset),
        end: loc.end
    };
    if (length != null) {
        newLoc.end = advancePositionWithClone(loc.start, loc.source, offset + length);
    }
    return newLoc;
}
function advancePositionWithClone(pos, source, numberOfCharacters = source.length) {
    return advancePositionWithMutation(extend({}, pos), source, numberOfCharacters);
}
// advance by mutation without cloning (for performance reasons), since this
// gets called a lot in the parser
function advancePositionWithMutation(pos, source, numberOfCharacters = source.length) {
    let linesCount = 0;
    let lastNewLinePos = -1;
    for (let i = 0; i < numberOfCharacters; i++) {
        if (source.charCodeAt(i) === 10 /* newline char code */) {
            linesCount++;
            lastNewLinePos = i;
        }
    }
    pos.offset += numberOfCharacters;
    pos.line += linesCount;
    pos.column =
        lastNewLinePos === -1
            ? pos.column + numberOfCharacters
            : numberOfCharacters - lastNewLinePos;
    return pos;
}
function assert(condition, msg) {
    /* istanbul ignore if */
    if (!condition) {
        throw new Error(msg || `unexpected compiler condition`);
    }
}
function findDir(node, name, allowEmpty = false) {
    for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i];
        if (p.type === 7 /* DIRECTIVE */ &&
            (allowEmpty || p.exp) &&
            (isString(name) ? p.name === name : name.test(p.name))) {
            return p;
        }
    }
}
function findProp(node, name, dynamicOnly = false, allowEmpty = false) {
    for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i];
        if (p.type === 6 /* ATTRIBUTE */) {
            if (dynamicOnly)
                continue;
            if (p.name === name && (p.value || allowEmpty)) {
                return p;
            }
        }
        else if (p.name === 'bind' &&
            (p.exp || allowEmpty) &&
            isBindKey(p.arg, name)) {
            return p;
        }
    }
}
function isBindKey(arg, name) {
    return !!(arg && isStaticExp(arg) && arg.content === name);
}
function hasDynamicKeyVBind(node) {
    return node.props.some(p => p.type === 7 /* DIRECTIVE */ &&
        p.name === 'bind' &&
        (!p.arg || // v-bind="obj"
            p.arg.type !== 4 /* SIMPLE_EXPRESSION */ || // v-bind:[_ctx.foo]
            !p.arg.isStatic) // v-bind:[foo]
    );
}
function isText(node) {
    return node.type === 5 /* INTERPOLATION */ || node.type === 2 /* TEXT */;
}
function isVSlot(p) {
    return p.type === 7 /* DIRECTIVE */ && p.name === 'slot';
}
function isTemplateNode(node) {
    return (node.type === 1 /* ELEMENT */ && node.tagType === 3 /* TEMPLATE */);
}
function isSlotOutlet(node) {
    return node.type === 1 /* ELEMENT */ && node.tagType === 2 /* SLOT */;
}
function injectProp(node, prop, context) {
    let propsWithInjection;
    const props = node.type === 13 /* VNODE_CALL */ ? node.props : node.arguments[2];
    if (props == null || isString(props)) {
        propsWithInjection = createObjectExpression([prop]);
    }
    else if (props.type === 14 /* JS_CALL_EXPRESSION */) {
        // merged props... add ours
        // only inject key to object literal if it's the first argument so that
        // if doesn't override user provided keys
        const first = props.arguments[0];
        if (!isString(first) && first.type === 15 /* JS_OBJECT_EXPRESSION */) {
            first.properties.unshift(prop);
        }
        else {
            if (props.callee === TO_HANDLERS) {
                // #2366
                propsWithInjection = createCallExpression(context.helper(MERGE_PROPS), [
                    createObjectExpression([prop]),
                    props
                ]);
            }
            else {
                props.arguments.unshift(createObjectExpression([prop]));
            }
        }
        !propsWithInjection && (propsWithInjection = props);
    }
    else if (props.type === 15 /* JS_OBJECT_EXPRESSION */) {
        let alreadyExists = false;
        // check existing key to avoid overriding user provided keys
        if (prop.key.type === 4 /* SIMPLE_EXPRESSION */) {
            const propKeyName = prop.key.content;
            alreadyExists = props.properties.some(p => p.key.type === 4 /* SIMPLE_EXPRESSION */ &&
                p.key.content === propKeyName);
        }
        if (!alreadyExists) {
            props.properties.unshift(prop);
        }
        propsWithInjection = props;
    }
    else {
        // single v-bind with expression, return a merged replacement
        propsWithInjection = createCallExpression(context.helper(MERGE_PROPS), [
            createObjectExpression([prop]),
            props
        ]);
    }
    if (node.type === 13 /* VNODE_CALL */) {
        node.props = propsWithInjection;
    }
    else {
        node.arguments[2] = propsWithInjection;
    }
}
function toValidAssetId(name, type) {
    return `_${type}_${name.replace(/[^\w]/g, '_')}`;
}
// Check if a node contains expressions that reference current context scope ids
function hasScopeRef(node, ids) {
    if (!node || Object.keys(ids).length === 0) {
        return false;
    }
    switch (node.type) {
        case 1 /* ELEMENT */:
            for (let i = 0; i < node.props.length; i++) {
                const p = node.props[i];
                if (p.type === 7 /* DIRECTIVE */ &&
                    (hasScopeRef(p.arg, ids) || hasScopeRef(p.exp, ids))) {
                    return true;
                }
            }
            return node.children.some(c => hasScopeRef(c, ids));
        case 11 /* FOR */:
            if (hasScopeRef(node.source, ids)) {
                return true;
            }
            return node.children.some(c => hasScopeRef(c, ids));
        case 9 /* IF */:
            return node.branches.some(b => hasScopeRef(b, ids));
        case 10 /* IF_BRANCH */:
            if (hasScopeRef(node.condition, ids)) {
                return true;
            }
            return node.children.some(c => hasScopeRef(c, ids));
        case 4 /* SIMPLE_EXPRESSION */:
            return (!node.isStatic &&
                isSimpleIdentifier(node.content) &&
                !!ids[node.content]);
        case 8 /* COMPOUND_EXPRESSION */:
            return node.children.some(c => isObject(c) && hasScopeRef(c, ids));
        case 5 /* INTERPOLATION */:
        case 12 /* TEXT_CALL */:
            return hasScopeRef(node.content, ids);
        case 2 /* TEXT */:
        case 3 /* COMMENT */:
            return false;
        default:
            return false;
    }
}

// The default decoder only provides escapes for characters reserved as part of
// the template syntax, and is only used if the custom renderer did not provide
// a platform-specific decoder.
const decodeRE = /&(gt|lt|amp|apos|quot);/g;
const decodeMap = {
    gt: '>',
    lt: '<',
    amp: '&',
    apos: "'",
    quot: '"'
};
const defaultParserOptions = {
    delimiters: [`{{`, `}}`],
    getNamespace: () => 0 /* HTML */,
    getTextMode: () => 0 /* DATA */,
    isVoidTag: NO,
    isPreTag: NO,
    isCustomElement: NO,
    decodeEntities: (rawText) => rawText.replace(decodeRE, (_, p1) => decodeMap[p1]),
    onError: defaultOnError,
    comments: false
};
function baseParse(content, options = {}) {
    const context = createParserContext(content, options);
    const start = getCursor(context);
    return createRoot(parseChildren(context, 0 /* DATA */, []), getSelection(context, start));
}
function createParserContext(content, rawOptions) {
    const options = extend({}, defaultParserOptions);
    for (const key in rawOptions) {
        // @ts-ignore
        options[key] = rawOptions[key] || defaultParserOptions[key];
    }
    return {
        options,
        column: 1,
        line: 1,
        offset: 0,
        originalSource: content,
        source: content,
        inPre: false,
        inVPre: false
    };
}
function parseChildren(context, mode, ancestors) {
    const parent = last(ancestors);
    const ns = parent ? parent.ns : 0 /* HTML */;
    const nodes = [];
    while (!isEnd(context, mode, ancestors)) {
        const s = context.source;
        let node = undefined;
        if (mode === 0 /* DATA */ || mode === 1 /* RCDATA */) {
            if (!context.inVPre && startsWith(s, context.options.delimiters[0])) {
                // '{{'
                node = parseInterpolation(context, mode);
            }
            else if (mode === 0 /* DATA */ && s[0] === '<') {
                // https://html.spec.whatwg.org/multipage/parsing.html#tag-open-state
                if (s.length === 1) {
                    emitError(context, 5 /* EOF_BEFORE_TAG_NAME */, 1);
                }
                else if (s[1] === '!') {
                    // https://html.spec.whatwg.org/multipage/parsing.html#markup-declaration-open-state
                    if (startsWith(s, '<!--')) {
                        node = parseComment(context);
                    }
                    else if (startsWith(s, '<!DOCTYPE')) {
                        // Ignore DOCTYPE by a limitation.
                        node = parseBogusComment(context);
                    }
                    else if (startsWith(s, '<![CDATA[')) {
                        if (ns !== 0 /* HTML */) {
                            node = parseCDATA(context, ancestors);
                        }
                        else {
                            emitError(context, 1 /* CDATA_IN_HTML_CONTENT */);
                            node = parseBogusComment(context);
                        }
                    }
                    else {
                        emitError(context, 11 /* INCORRECTLY_OPENED_COMMENT */);
                        node = parseBogusComment(context);
                    }
                }
                else if (s[1] === '/') {
                    // https://html.spec.whatwg.org/multipage/parsing.html#end-tag-open-state
                    if (s.length === 2) {
                        emitError(context, 5 /* EOF_BEFORE_TAG_NAME */, 2);
                    }
                    else if (s[2] === '>') {
                        emitError(context, 14 /* MISSING_END_TAG_NAME */, 2);
                        advanceBy(context, 3);
                        continue;
                    }
                    else if (/[a-z]/i.test(s[2])) {
                        emitError(context, 23 /* X_INVALID_END_TAG */);
                        parseTag(context, 1 /* End */, parent);
                        continue;
                    }
                    else {
                        emitError(context, 12 /* INVALID_FIRST_CHARACTER_OF_TAG_NAME */, 2);
                        node = parseBogusComment(context);
                    }
                }
                else if (/[a-z]/i.test(s[1])) {
                    node = parseElement(context, ancestors);
                }
                else if (s[1] === '?') {
                    emitError(context, 21 /* UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME */, 1);
                    node = parseBogusComment(context);
                }
                else {
                    emitError(context, 12 /* INVALID_FIRST_CHARACTER_OF_TAG_NAME */, 1);
                }
            }
        }
        if (!node) {
            node = parseText(context, mode);
        }
        if (isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                pushNode(nodes, node[i]);
            }
        }
        else {
            pushNode(nodes, node);
        }
    }
    // Whitespace management for more efficient output
    // (same as v2 whitespace: 'condense')
    let removedWhitespace = false;
    if (mode !== 2 /* RAWTEXT */) {
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!context.inPre && node.type === 2 /* TEXT */) {
                if (!/[^\t\r\n\f ]/.test(node.content)) {
                    const prev = nodes[i - 1];
                    const next = nodes[i + 1];
                    // If:
                    // - the whitespace is the first or last node, or:
                    // - the whitespace is adjacent to a comment, or:
                    // - the whitespace is between two elements AND contains newline
                    // Then the whitespace is ignored.
                    if (!prev ||
                        !next ||
                        prev.type === 3 /* COMMENT */ ||
                        next.type === 3 /* COMMENT */ ||
                        (prev.type === 1 /* ELEMENT */ &&
                            next.type === 1 /* ELEMENT */ &&
                            /[\r\n]/.test(node.content))) {
                        removedWhitespace = true;
                        nodes[i] = null;
                    }
                    else {
                        // Otherwise, condensed consecutive whitespace inside the text
                        // down to a single space
                        node.content = ' ';
                    }
                }
                else {
                    node.content = node.content.replace(/[\t\r\n\f ]+/g, ' ');
                }
            }
        }
        if (context.inPre && parent && context.options.isPreTag(parent.tag)) {
            // remove leading newline per html spec
            // https://html.spec.whatwg.org/multipage/grouping-content.html#the-pre-element
            const first = nodes[0];
            if (first && first.type === 2 /* TEXT */) {
                first.content = first.content.replace(/^\r?\n/, '');
            }
        }
    }
    return removedWhitespace ? nodes.filter(Boolean) : nodes;
}
function pushNode(nodes, node) {
    if (node.type === 2 /* TEXT */) {
        const prev = last(nodes);
        // Merge if both this and the previous node are text and those are
        // consecutive. This happens for cases like "a < b".
        if (prev &&
            prev.type === 2 /* TEXT */ &&
            prev.loc.end.offset === node.loc.start.offset) {
            prev.content += node.content;
            prev.loc.end = node.loc.end;
            prev.loc.source += node.loc.source;
            return;
        }
    }
    nodes.push(node);
}
function parseCDATA(context, ancestors) {
    advanceBy(context, 9);
    const nodes = parseChildren(context, 3 /* CDATA */, ancestors);
    if (context.source.length === 0) {
        emitError(context, 6 /* EOF_IN_CDATA */);
    }
    else {
        advanceBy(context, 3);
    }
    return nodes;
}
function parseComment(context) {
    const start = getCursor(context);
    let content;
    // Regular comment.
    const match = /--(\!)?>/.exec(context.source);
    if (!match) {
        content = context.source.slice(4);
        advanceBy(context, context.source.length);
        emitError(context, 7 /* EOF_IN_COMMENT */);
    }
    else {
        if (match.index <= 3) {
            emitError(context, 0 /* ABRUPT_CLOSING_OF_EMPTY_COMMENT */);
        }
        if (match[1]) {
            emitError(context, 10 /* INCORRECTLY_CLOSED_COMMENT */);
        }
        content = context.source.slice(4, match.index);
        // Advancing with reporting nested comments.
        const s = context.source.slice(0, match.index);
        let prevIndex = 1, nestedIndex = 0;
        while ((nestedIndex = s.indexOf('<!--', prevIndex)) !== -1) {
            advanceBy(context, nestedIndex - prevIndex + 1);
            if (nestedIndex + 4 < s.length) {
                emitError(context, 16 /* NESTED_COMMENT */);
            }
            prevIndex = nestedIndex + 1;
        }
        advanceBy(context, match.index + match[0].length - prevIndex + 1);
    }
    return {
        type: 3 /* COMMENT */,
        content,
        loc: getSelection(context, start)
    };
}
function parseBogusComment(context) {
    const start = getCursor(context);
    const contentStart = context.source[1] === '?' ? 1 : 2;
    let content;
    const closeIndex = context.source.indexOf('>');
    if (closeIndex === -1) {
        content = context.source.slice(contentStart);
        advanceBy(context, context.source.length);
    }
    else {
        content = context.source.slice(contentStart, closeIndex);
        advanceBy(context, closeIndex + 1);
    }
    return {
        type: 3 /* COMMENT */,
        content,
        loc: getSelection(context, start)
    };
}
function parseElement(context, ancestors) {
    // Start tag.
    const wasInPre = context.inPre;
    const wasInVPre = context.inVPre;
    const parent = last(ancestors);
    const element = parseTag(context, 0 /* Start */, parent);
    const isPreBoundary = context.inPre && !wasInPre;
    const isVPreBoundary = context.inVPre && !wasInVPre;
    if (element.isSelfClosing || context.options.isVoidTag(element.tag)) {
        return element;
    }
    // Children.
    ancestors.push(element);
    const mode = context.options.getTextMode(element, parent);
    const children = parseChildren(context, mode, ancestors);
    ancestors.pop();
    element.children = children;
    // End tag.
    if (startsWithEndTagOpen(context.source, element.tag)) {
        parseTag(context, 1 /* End */, parent);
    }
    else {
        emitError(context, 24 /* X_MISSING_END_TAG */, 0, element.loc.start);
        if (context.source.length === 0 && element.tag.toLowerCase() === 'script') {
            const first = children[0];
            if (first && startsWith(first.loc.source, '<!--')) {
                emitError(context, 8 /* EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT */);
            }
        }
    }
    element.loc = getSelection(context, element.loc.start);
    if (isPreBoundary) {
        context.inPre = false;
    }
    if (isVPreBoundary) {
        context.inVPre = false;
    }
    return element;
}
const isSpecialTemplateDirective = /*#__PURE__*/ makeMap(`if,else,else-if,for,slot`);
/**
 * Parse a tag (E.g. `<div id=a>`) with that type (start tag or end tag).
 */
function parseTag(context, type, parent) {
    // Tag open.
    const start = getCursor(context);
    const match = /^<\/?([a-z][^\t\r\n\f />]*)/i.exec(context.source);
    const tag = match[1];
    const ns = context.options.getNamespace(tag, parent);
    advanceBy(context, match[0].length);
    advanceSpaces(context);
    // save current state in case we need to re-parse attributes with v-pre
    const cursor = getCursor(context);
    const currentSource = context.source;
    // Attributes.
    let props = parseAttributes(context, type);
    // check <pre> tag
    if (context.options.isPreTag(tag)) {
        context.inPre = true;
    }
    // check v-pre
    if (!context.inVPre &&
        props.some(p => p.type === 7 /* DIRECTIVE */ && p.name === 'pre')) {
        context.inVPre = true;
        // reset context
        extend(context, cursor);
        context.source = currentSource;
        // re-parse attrs and filter out v-pre itself
        props = parseAttributes(context, type).filter(p => p.name !== 'v-pre');
    }
    // Tag close.
    let isSelfClosing = false;
    if (context.source.length === 0) {
        emitError(context, 9 /* EOF_IN_TAG */);
    }
    else {
        isSelfClosing = startsWith(context.source, '/>');
        if (type === 1 /* End */ && isSelfClosing) {
            emitError(context, 4 /* END_TAG_WITH_TRAILING_SOLIDUS */);
        }
        advanceBy(context, isSelfClosing ? 2 : 1);
    }
    let tagType = 0 /* ELEMENT */;
    const options = context.options;
    if (!context.inVPre && !options.isCustomElement(tag)) {
        const hasVIs = props.some(p => p.type === 7 /* DIRECTIVE */ && p.name === 'is');
        if (options.isNativeTag && !hasVIs) {
            if (!options.isNativeTag(tag))
                tagType = 1 /* COMPONENT */;
        }
        else if (hasVIs ||
            isCoreComponent(tag) ||
            (options.isBuiltInComponent && options.isBuiltInComponent(tag)) ||
            /^[A-Z]/.test(tag) ||
            tag === 'component') {
            tagType = 1 /* COMPONENT */;
        }
        if (tag === 'slot') {
            tagType = 2 /* SLOT */;
        }
        else if (tag === 'template' &&
            props.some(p => {
                return (p.type === 7 /* DIRECTIVE */ && isSpecialTemplateDirective(p.name));
            })) {
            tagType = 3 /* TEMPLATE */;
        }
    }
    return {
        type: 1 /* ELEMENT */,
        ns,
        tag,
        tagType,
        props,
        isSelfClosing,
        children: [],
        loc: getSelection(context, start),
        codegenNode: undefined // to be created during transform phase
    };
}
function parseAttributes(context, type) {
    const props = [];
    const attributeNames = new Set();
    while (context.source.length > 0 &&
        !startsWith(context.source, '>') &&
        !startsWith(context.source, '/>')) {
        if (startsWith(context.source, '/')) {
            emitError(context, 22 /* UNEXPECTED_SOLIDUS_IN_TAG */);
            advanceBy(context, 1);
            advanceSpaces(context);
            continue;
        }
        if (type === 1 /* End */) {
            emitError(context, 3 /* END_TAG_WITH_ATTRIBUTES */);
        }
        const attr = parseAttribute(context, attributeNames);
        if (type === 0 /* Start */) {
            props.push(attr);
        }
        if (/^[^\t\r\n\f />]/.test(context.source)) {
            emitError(context, 15 /* MISSING_WHITESPACE_BETWEEN_ATTRIBUTES */);
        }
        advanceSpaces(context);
    }
    return props;
}
function parseAttribute(context, nameSet) {
    // Name.
    const start = getCursor(context);
    const match = /^[^\t\r\n\f />][^\t\r\n\f />=]*/.exec(context.source);
    const name = match[0];
    if (nameSet.has(name)) {
        emitError(context, 2 /* DUPLICATE_ATTRIBUTE */);
    }
    nameSet.add(name);
    if (name[0] === '=') {
        emitError(context, 19 /* UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME */);
    }
    {
        const pattern = /["'<]/g;
        let m;
        while ((m = pattern.exec(name))) {
            emitError(context, 17 /* UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME */, m.index);
        }
    }
    advanceBy(context, name.length);
    // Value
    let value = undefined;
    if (/^[\t\r\n\f ]*=/.test(context.source)) {
        advanceSpaces(context);
        advanceBy(context, 1);
        advanceSpaces(context);
        value = parseAttributeValue(context);
        if (!value) {
            emitError(context, 13 /* MISSING_ATTRIBUTE_VALUE */);
        }
    }
    const loc = getSelection(context, start);
    if (!context.inVPre && /^(v-|:|@|#)/.test(name)) {
        const match = /(?:^v-([a-z0-9-]+))?(?:(?::|^@|^#)(\[[^\]]+\]|[^\.]+))?(.+)?$/i.exec(name);
        const dirName = match[1] ||
            (startsWith(name, ':') ? 'bind' : startsWith(name, '@') ? 'on' : 'slot');
        let arg;
        if (match[2]) {
            const isSlot = dirName === 'slot';
            const startOffset = name.indexOf(match[2]);
            const loc = getSelection(context, getNewPosition(context, start, startOffset), getNewPosition(context, start, startOffset + match[2].length + ((isSlot && match[3]) || '').length));
            let content = match[2];
            let isStatic = true;
            if (content.startsWith('[')) {
                isStatic = false;
                if (!content.endsWith(']')) {
                    emitError(context, 26 /* X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END */);
                }
                content = content.substr(1, content.length - 2);
            }
            else if (isSlot) {
                // #1241 special case for v-slot: vuetify relies extensively on slot
                // names containing dots. v-slot doesn't have any modifiers and Vue 2.x
                // supports such usage so we are keeping it consistent with 2.x.
                content += match[3] || '';
            }
            arg = {
                type: 4 /* SIMPLE_EXPRESSION */,
                content,
                isStatic,
                constType: isStatic
                    ? 3 /* CAN_STRINGIFY */
                    : 0 /* NOT_CONSTANT */,
                loc
            };
        }
        if (value && value.isQuoted) {
            const valueLoc = value.loc;
            valueLoc.start.offset++;
            valueLoc.start.column++;
            valueLoc.end = advancePositionWithClone(valueLoc.start, value.content);
            valueLoc.source = valueLoc.source.slice(1, -1);
        }
        return {
            type: 7 /* DIRECTIVE */,
            name: dirName,
            exp: value && {
                type: 4 /* SIMPLE_EXPRESSION */,
                content: value.content,
                isStatic: false,
                // Treat as non-constant by default. This can be potentially set to
                // other values by `transformExpression` to make it eligible for hoisting.
                constType: 0 /* NOT_CONSTANT */,
                loc: value.loc
            },
            arg,
            modifiers: match[3] ? match[3].substr(1).split('.') : [],
            loc
        };
    }
    return {
        type: 6 /* ATTRIBUTE */,
        name,
        value: value && {
            type: 2 /* TEXT */,
            content: value.content,
            loc: value.loc
        },
        loc
    };
}
function parseAttributeValue(context) {
    const start = getCursor(context);
    let content;
    const quote = context.source[0];
    const isQuoted = quote === `"` || quote === `'`;
    if (isQuoted) {
        // Quoted value.
        advanceBy(context, 1);
        const endIndex = context.source.indexOf(quote);
        if (endIndex === -1) {
            content = parseTextData(context, context.source.length, 4 /* ATTRIBUTE_VALUE */);
        }
        else {
            content = parseTextData(context, endIndex, 4 /* ATTRIBUTE_VALUE */);
            advanceBy(context, 1);
        }
    }
    else {
        // Unquoted
        const match = /^[^\t\r\n\f >]+/.exec(context.source);
        if (!match) {
            return undefined;
        }
        const unexpectedChars = /["'<=`]/g;
        let m;
        while ((m = unexpectedChars.exec(match[0]))) {
            emitError(context, 18 /* UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE */, m.index);
        }
        content = parseTextData(context, match[0].length, 4 /* ATTRIBUTE_VALUE */);
    }
    return { content, isQuoted, loc: getSelection(context, start) };
}
function parseInterpolation(context, mode) {
    const [open, close] = context.options.delimiters;
    const closeIndex = context.source.indexOf(close, open.length);
    if (closeIndex === -1) {
        emitError(context, 25 /* X_MISSING_INTERPOLATION_END */);
        return undefined;
    }
    const start = getCursor(context);
    advanceBy(context, open.length);
    const innerStart = getCursor(context);
    const innerEnd = getCursor(context);
    const rawContentLength = closeIndex - open.length;
    const rawContent = context.source.slice(0, rawContentLength);
    const preTrimContent = parseTextData(context, rawContentLength, mode);
    const content = preTrimContent.trim();
    const startOffset = preTrimContent.indexOf(content);
    if (startOffset > 0) {
        advancePositionWithMutation(innerStart, rawContent, startOffset);
    }
    const endOffset = rawContentLength - (preTrimContent.length - content.length - startOffset);
    advancePositionWithMutation(innerEnd, rawContent, endOffset);
    advanceBy(context, close.length);
    return {
        type: 5 /* INTERPOLATION */,
        content: {
            type: 4 /* SIMPLE_EXPRESSION */,
            isStatic: false,
            // Set `isConstant` to false by default and will decide in transformExpression
            constType: 0 /* NOT_CONSTANT */,
            content,
            loc: getSelection(context, innerStart, innerEnd)
        },
        loc: getSelection(context, start)
    };
}
function parseText(context, mode) {
    const endTokens = ['<', context.options.delimiters[0]];
    if (mode === 3 /* CDATA */) {
        endTokens.push(']]>');
    }
    let endIndex = context.source.length;
    for (let i = 0; i < endTokens.length; i++) {
        const index = context.source.indexOf(endTokens[i], 1);
        if (index !== -1 && endIndex > index) {
            endIndex = index;
        }
    }
    const start = getCursor(context);
    const content = parseTextData(context, endIndex, mode);
    return {
        type: 2 /* TEXT */,
        content,
        loc: getSelection(context, start)
    };
}
/**
 * Get text data with a given length from the current location.
 * This translates HTML entities in the text data.
 */
function parseTextData(context, length, mode) {
    const rawText = context.source.slice(0, length);
    advanceBy(context, length);
    if (mode === 2 /* RAWTEXT */ ||
        mode === 3 /* CDATA */ ||
        rawText.indexOf('&') === -1) {
        return rawText;
    }
    else {
        // DATA or RCDATA containing "&"". Entity decoding required.
        return context.options.decodeEntities(rawText, mode === 4 /* ATTRIBUTE_VALUE */);
    }
}
function getCursor(context) {
    const { column, line, offset } = context;
    return { column, line, offset };
}
function getSelection(context, start, end) {
    end = end || getCursor(context);
    return {
        start,
        end,
        source: context.originalSource.slice(start.offset, end.offset)
    };
}
function last(xs) {
    return xs[xs.length - 1];
}
function startsWith(source, searchString) {
    return source.startsWith(searchString);
}
function advanceBy(context, numberOfCharacters) {
    const { source } = context;
    advancePositionWithMutation(context, source, numberOfCharacters);
    context.source = source.slice(numberOfCharacters);
}
function advanceSpaces(context) {
    const match = /^[\t\r\n\f ]+/.exec(context.source);
    if (match) {
        advanceBy(context, match[0].length);
    }
}
function getNewPosition(context, start, numberOfCharacters) {
    return advancePositionWithClone(start, context.originalSource.slice(start.offset, numberOfCharacters), numberOfCharacters);
}
function emitError(context, code, offset, loc = getCursor(context)) {
    if (offset) {
        loc.offset += offset;
        loc.column += offset;
    }
    context.options.onError(createCompilerError(code, {
        start: loc,
        end: loc,
        source: ''
    }));
}
function isEnd(context, mode, ancestors) {
    const s = context.source;
    switch (mode) {
        case 0 /* DATA */:
            if (startsWith(s, '</')) {
                //TODO: probably bad performance
                for (let i = ancestors.length - 1; i >= 0; --i) {
                    if (startsWithEndTagOpen(s, ancestors[i].tag)) {
                        return true;
                    }
                }
            }
            break;
        case 1 /* RCDATA */:
        case 2 /* RAWTEXT */: {
            const parent = last(ancestors);
            if (parent && startsWithEndTagOpen(s, parent.tag)) {
                return true;
            }
            break;
        }
        case 3 /* CDATA */:
            if (startsWith(s, ']]>')) {
                return true;
            }
            break;
    }
    return !s;
}
function startsWithEndTagOpen(source, tag) {
    return (startsWith(source, '</') &&
        source.substr(2, tag.length).toLowerCase() === tag.toLowerCase() &&
        /[\t\r\n\f />]/.test(source[2 + tag.length] || '>'));
}

function hoistStatic(root, context) {
    walk(root, context, 
    // Root node is unfortunately non-hoistable due to potential parent
    // fallthrough attributes.
    isSingleElementRoot(root, root.children[0]));
}
function isSingleElementRoot(root, child) {
    const { children } = root;
    return (children.length === 1 &&
        child.type === 1 /* ELEMENT */ &&
        !isSlotOutlet(child));
}
function walk(node, context, doNotHoistNode = false) {
    let hasHoistedNode = false;
    // Some transforms, e.g. transformAssetUrls from @vue/compiler-sfc, replaces
    // static bindings with expressions. These expressions are guaranteed to be
    // constant so they are still eligible for hoisting, but they are only
    // available at runtime and therefore cannot be evaluated ahead of time.
    // This is only a concern for pre-stringification (via transformHoist by
    // @vue/compiler-dom), but doing it here allows us to perform only one full
    // walk of the AST and allow `stringifyStatic` to stop walking as soon as its
    // stringficiation threshold is met.
    let canStringify = true;
    const { children } = node;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        // only plain elements & text calls are eligible for hoisting.
        if (child.type === 1 /* ELEMENT */ &&
            child.tagType === 0 /* ELEMENT */) {
            const constantType = doNotHoistNode
                ? 0 /* NOT_CONSTANT */
                : getConstantType(child, context);
            if (constantType > 0 /* NOT_CONSTANT */) {
                if (constantType < 3 /* CAN_STRINGIFY */) {
                    canStringify = false;
                }
                if (constantType >= 2 /* CAN_HOIST */) {
                    child.codegenNode.patchFlag =
                        -1 /* HOISTED */ + ( ` /* HOISTED */` );
                    child.codegenNode = context.hoist(child.codegenNode);
                    hasHoistedNode = true;
                    continue;
                }
            }
            else {
                // node may contain dynamic children, but its props may be eligible for
                // hoisting.
                const codegenNode = child.codegenNode;
                if (codegenNode.type === 13 /* VNODE_CALL */) {
                    const flag = getPatchFlag(codegenNode);
                    if ((!flag ||
                        flag === 512 /* NEED_PATCH */ ||
                        flag === 1 /* TEXT */) &&
                        getGeneratedPropsConstantType(child, context) >=
                            2 /* CAN_HOIST */) {
                        const props = getNodeProps(child);
                        if (props) {
                            codegenNode.props = context.hoist(props);
                        }
                    }
                }
            }
        }
        else if (child.type === 12 /* TEXT_CALL */) {
            const contentType = getConstantType(child.content, context);
            if (contentType > 0) {
                if (contentType < 3 /* CAN_STRINGIFY */) {
                    canStringify = false;
                }
                if (contentType >= 2 /* CAN_HOIST */) {
                    child.codegenNode = context.hoist(child.codegenNode);
                    hasHoistedNode = true;
                }
            }
        }
        // walk further
        if (child.type === 1 /* ELEMENT */) {
            walk(child, context);
        }
        else if (child.type === 11 /* FOR */) {
            // Do not hoist v-for single child because it has to be a block
            walk(child, context, child.children.length === 1);
        }
        else if (child.type === 9 /* IF */) {
            for (let i = 0; i < child.branches.length; i++) {
                // Do not hoist v-if single child because it has to be a block
                walk(child.branches[i], context, child.branches[i].children.length === 1);
            }
        }
    }
    if (canStringify && hasHoistedNode && context.transformHoist) {
        context.transformHoist(children, context, node);
    }
}
function getConstantType(node, context) {
    const { constantCache } = context;
    switch (node.type) {
        case 1 /* ELEMENT */:
            if (node.tagType !== 0 /* ELEMENT */) {
                return 0 /* NOT_CONSTANT */;
            }
            const cached = constantCache.get(node);
            if (cached !== undefined) {
                return cached;
            }
            const codegenNode = node.codegenNode;
            if (codegenNode.type !== 13 /* VNODE_CALL */) {
                return 0 /* NOT_CONSTANT */;
            }
            const flag = getPatchFlag(codegenNode);
            if (!flag) {
                let returnType = 3 /* CAN_STRINGIFY */;
                // Element itself has no patch flag. However we still need to check:
                // 1. Even for a node with no patch flag, it is possible for it to contain
                // non-hoistable expressions that refers to scope variables, e.g. compiler
                // injected keys or cached event handlers. Therefore we need to always
                // check the codegenNode's props to be sure.
                const generatedPropsType = getGeneratedPropsConstantType(node, context);
                if (generatedPropsType === 0 /* NOT_CONSTANT */) {
                    constantCache.set(node, 0 /* NOT_CONSTANT */);
                    return 0 /* NOT_CONSTANT */;
                }
                if (generatedPropsType < returnType) {
                    returnType = generatedPropsType;
                }
                // 2. its children.
                for (let i = 0; i < node.children.length; i++) {
                    const childType = getConstantType(node.children[i], context);
                    if (childType === 0 /* NOT_CONSTANT */) {
                        constantCache.set(node, 0 /* NOT_CONSTANT */);
                        return 0 /* NOT_CONSTANT */;
                    }
                    if (childType < returnType) {
                        returnType = childType;
                    }
                }
                // 3. if the type is not already CAN_SKIP_PATCH which is the lowest non-0
                // type, check if any of the props can cause the type to be lowered
                // we can skip can_patch because it's guaranteed by the absence of a
                // patchFlag.
                if (returnType > 1 /* CAN_SKIP_PATCH */) {
                    for (let i = 0; i < node.props.length; i++) {
                        const p = node.props[i];
                        if (p.type === 7 /* DIRECTIVE */ && p.name === 'bind' && p.exp) {
                            const expType = getConstantType(p.exp, context);
                            if (expType === 0 /* NOT_CONSTANT */) {
                                constantCache.set(node, 0 /* NOT_CONSTANT */);
                                return 0 /* NOT_CONSTANT */;
                            }
                            if (expType < returnType) {
                                returnType = expType;
                            }
                        }
                    }
                }
                // only svg/foreignObject could be block here, however if they are
                // static then they don't need to be blocks since there will be no
                // nested updates.
                if (codegenNode.isBlock) {
                    codegenNode.isBlock = false;
                    context.helper(CREATE_VNODE);
                }
                constantCache.set(node, returnType);
                return returnType;
            }
            else {
                constantCache.set(node, 0 /* NOT_CONSTANT */);
                return 0 /* NOT_CONSTANT */;
            }
        case 2 /* TEXT */:
        case 3 /* COMMENT */:
            return 3 /* CAN_STRINGIFY */;
        case 9 /* IF */:
        case 11 /* FOR */:
        case 10 /* IF_BRANCH */:
            return 0 /* NOT_CONSTANT */;
        case 5 /* INTERPOLATION */:
        case 12 /* TEXT_CALL */:
            return getConstantType(node.content, context);
        case 4 /* SIMPLE_EXPRESSION */:
            return node.constType;
        case 8 /* COMPOUND_EXPRESSION */:
            let returnType = 3 /* CAN_STRINGIFY */;
            for (let i = 0; i < node.children.length; i++) {
                const child = node.children[i];
                if (isString(child) || isSymbol(child)) {
                    continue;
                }
                const childType = getConstantType(child, context);
                if (childType === 0 /* NOT_CONSTANT */) {
                    return 0 /* NOT_CONSTANT */;
                }
                else if (childType < returnType) {
                    returnType = childType;
                }
            }
            return returnType;
        default:
            return 0 /* NOT_CONSTANT */;
    }
}
function getGeneratedPropsConstantType(node, context) {
    let returnType = 3 /* CAN_STRINGIFY */;
    const props = getNodeProps(node);
    if (props && props.type === 15 /* JS_OBJECT_EXPRESSION */) {
        const { properties } = props;
        for (let i = 0; i < properties.length; i++) {
            const { key, value } = properties[i];
            const keyType = getConstantType(key, context);
            if (keyType === 0 /* NOT_CONSTANT */) {
                return keyType;
            }
            if (keyType < returnType) {
                returnType = keyType;
            }
            if (value.type !== 4 /* SIMPLE_EXPRESSION */) {
                return 0 /* NOT_CONSTANT */;
            }
            const valueType = getConstantType(value, context);
            if (valueType === 0 /* NOT_CONSTANT */) {
                return valueType;
            }
            if (valueType < returnType) {
                returnType = valueType;
            }
        }
    }
    return returnType;
}
function getNodeProps(node) {
    const codegenNode = node.codegenNode;
    if (codegenNode.type === 13 /* VNODE_CALL */) {
        return codegenNode.props;
    }
}
function getPatchFlag(node) {
    const flag = node.patchFlag;
    return flag ? parseInt(flag, 10) : undefined;
}

function createTransformContext(root, { filename = '', prefixIdentifiers = false, hoistStatic = false, cacheHandlers = false, nodeTransforms = [], directiveTransforms = {}, transformHoist = null, isBuiltInComponent = NOOP, isCustomElement = NOOP, expressionPlugins = [], scopeId = null, ssr = false, ssrCssVars = ``, bindingMetadata = EMPTY_OBJ, inline = false, isTS = false, onError = defaultOnError }) {
    const nameMatch = filename.replace(/\?.*$/, '').match(/([^/\\]+)\.\w+$/);
    const context = {
        // options
        selfName: nameMatch && capitalize(camelize(nameMatch[1])),
        prefixIdentifiers,
        hoistStatic,
        cacheHandlers,
        nodeTransforms,
        directiveTransforms,
        transformHoist,
        isBuiltInComponent,
        isCustomElement,
        expressionPlugins,
        scopeId,
        ssr,
        ssrCssVars,
        bindingMetadata,
        inline,
        isTS,
        onError,
        // state
        root,
        helpers: new Set(),
        components: new Set(),
        directives: new Set(),
        hoists: [],
        imports: new Set(),
        constantCache: new Map(),
        temps: 0,
        cached: 0,
        identifiers: Object.create(null),
        scopes: {
            vFor: 0,
            vSlot: 0,
            vPre: 0,
            vOnce: 0
        },
        parent: null,
        currentNode: root,
        childIndex: 0,
        // methods
        helper(name) {
            context.helpers.add(name);
            return name;
        },
        helperString(name) {
            return `_${helperNameMap[context.helper(name)]}`;
        },
        replaceNode(node) {
            /* istanbul ignore if */
            {
                if (!context.currentNode) {
                    throw new Error(`Node being replaced is already removed.`);
                }
                if (!context.parent) {
                    throw new Error(`Cannot replace root node.`);
                }
            }
            context.parent.children[context.childIndex] = context.currentNode = node;
        },
        removeNode(node) {
            if ( !context.parent) {
                throw new Error(`Cannot remove root node.`);
            }
            const list = context.parent.children;
            const removalIndex = node
                ? list.indexOf(node)
                : context.currentNode
                    ? context.childIndex
                    : -1;
            /* istanbul ignore if */
            if ( removalIndex < 0) {
                throw new Error(`node being removed is not a child of current parent`);
            }
            if (!node || node === context.currentNode) {
                // current node removed
                context.currentNode = null;
                context.onNodeRemoved();
            }
            else {
                // sibling node removed
                if (context.childIndex > removalIndex) {
                    context.childIndex--;
                    context.onNodeRemoved();
                }
            }
            context.parent.children.splice(removalIndex, 1);
        },
        onNodeRemoved: () => { },
        addIdentifiers(exp) {
            // identifier tracking only happens in non-browser builds.
            {
                if (isString(exp)) {
                    addId(exp);
                }
                else if (exp.identifiers) {
                    exp.identifiers.forEach(addId);
                }
                else if (exp.type === 4 /* SIMPLE_EXPRESSION */) {
                    addId(exp.content);
                }
            }
        },
        removeIdentifiers(exp) {
            {
                if (isString(exp)) {
                    removeId(exp);
                }
                else if (exp.identifiers) {
                    exp.identifiers.forEach(removeId);
                }
                else if (exp.type === 4 /* SIMPLE_EXPRESSION */) {
                    removeId(exp.content);
                }
            }
        },
        hoist(exp) {
            context.hoists.push(exp);
            const identifier = createSimpleExpression(`_hoisted_${context.hoists.length}`, false, exp.loc, 2 /* CAN_HOIST */);
            identifier.hoisted = exp;
            return identifier;
        },
        cache(exp, isVNode = false) {
            return createCacheExpression(++context.cached, exp, isVNode);
        }
    };
    function addId(id) {
        const { identifiers } = context;
        if (identifiers[id] === undefined) {
            identifiers[id] = 0;
        }
        identifiers[id]++;
    }
    function removeId(id) {
        context.identifiers[id]--;
    }
    return context;
}
function transform(root, options) {
    const context = createTransformContext(root, options);
    traverseNode(root, context);
    if (options.hoistStatic) {
        hoistStatic(root, context);
    }
    if (!options.ssr) {
        createRootCodegen(root, context);
    }
    // finalize meta information
    root.helpers = [...context.helpers];
    root.components = [...context.components];
    root.directives = [...context.directives];
    root.imports = [...context.imports];
    root.hoists = context.hoists;
    root.temps = context.temps;
    root.cached = context.cached;
}
function createRootCodegen(root, context) {
    const { helper } = context;
    const { children } = root;
    if (children.length === 1) {
        const child = children[0];
        // if the single child is an element, turn it into a block.
        if (isSingleElementRoot(root, child) && child.codegenNode) {
            // single element root is never hoisted so codegenNode will never be
            // SimpleExpressionNode
            const codegenNode = child.codegenNode;
            if (codegenNode.type === 13 /* VNODE_CALL */) {
                codegenNode.isBlock = true;
                helper(OPEN_BLOCK);
                helper(CREATE_BLOCK);
            }
            root.codegenNode = codegenNode;
        }
        else {
            // - single <slot/>, IfNode, ForNode: already blocks.
            // - single text node: always patched.
            // root codegen falls through via genNode()
            root.codegenNode = child;
        }
    }
    else if (children.length > 1) {
        // root has multiple nodes - return a fragment block.
        let patchFlag = 64 /* STABLE_FRAGMENT */;
        let patchFlagText = PatchFlagNames[64 /* STABLE_FRAGMENT */];
        // check if the fragment actually contains a single valid child with
        // the rest being comments
        if (
            children.filter(c => c.type !== 3 /* COMMENT */).length === 1) {
            patchFlag |= 2048 /* DEV_ROOT_FRAGMENT */;
            patchFlagText += `, ${PatchFlagNames[2048 /* DEV_ROOT_FRAGMENT */]}`;
        }
        root.codegenNode = createVNodeCall(context, helper(FRAGMENT), undefined, root.children, patchFlag + ( ` /* ${patchFlagText} */` ), undefined, undefined, true);
    }
    else ;
}
function traverseChildren(parent, context) {
    let i = 0;
    const nodeRemoved = () => {
        i--;
    };
    for (; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (isString(child))
            continue;
        context.parent = parent;
        context.childIndex = i;
        context.onNodeRemoved = nodeRemoved;
        traverseNode(child, context);
    }
}
function traverseNode(node, context) {
    context.currentNode = node;
    // apply transform plugins
    const { nodeTransforms } = context;
    const exitFns = [];
    for (let i = 0; i < nodeTransforms.length; i++) {
        const onExit = nodeTransforms[i](node, context);
        if (onExit) {
            if (isArray(onExit)) {
                exitFns.push(...onExit);
            }
            else {
                exitFns.push(onExit);
            }
        }
        if (!context.currentNode) {
            // node was removed
            return;
        }
        else {
            // node may have been replaced
            node = context.currentNode;
        }
    }
    switch (node.type) {
        case 3 /* COMMENT */:
            if (!context.ssr) {
                // inject import for the Comment symbol, which is needed for creating
                // comment nodes with `createVNode`
                context.helper(CREATE_COMMENT);
            }
            break;
        case 5 /* INTERPOLATION */:
            // no need to traverse, but we need to inject toString helper
            if (!context.ssr) {
                context.helper(TO_DISPLAY_STRING);
            }
            break;
        // for container types, further traverse downwards
        case 9 /* IF */:
            for (let i = 0; i < node.branches.length; i++) {
                traverseNode(node.branches[i], context);
            }
            break;
        case 10 /* IF_BRANCH */:
        case 11 /* FOR */:
        case 1 /* ELEMENT */:
        case 0 /* ROOT */:
            traverseChildren(node, context);
            break;
    }
    // exit transforms
    context.currentNode = node;
    let i = exitFns.length;
    while (i--) {
        exitFns[i]();
    }
}
function createStructuralDirectiveTransform(name, fn) {
    const matches = isString(name)
        ? (n) => n === name
        : (n) => name.test(n);
    return (node, context) => {
        if (node.type === 1 /* ELEMENT */) {
            const { props } = node;
            // structural directive transforms are not concerned with slots
            // as they are handled separately in vSlot.ts
            if (node.tagType === 3 /* TEMPLATE */ && props.some(isVSlot)) {
                return;
            }
            const exitFns = [];
            for (let i = 0; i < props.length; i++) {
                const prop = props[i];
                if (prop.type === 7 /* DIRECTIVE */ && matches(prop.name)) {
                    // structural directives are removed to avoid infinite recursion
                    // also we remove them *before* applying so that it can further
                    // traverse itself in case it moves the node around
                    props.splice(i, 1);
                    i--;
                    const onExit = fn(node, prop, context);
                    if (onExit)
                        exitFns.push(onExit);
                }
            }
            return exitFns;
        }
    };
}

const PURE_ANNOTATION = `/*#__PURE__*/`;
function createCodegenContext(ast, { mode = 'function', prefixIdentifiers = mode === 'module', sourceMap: sourceMap$1 = false, filename = `template.vue.html`, scopeId = null, optimizeImports = false, runtimeGlobalName = `Vue`, runtimeModuleName = `vue`, ssr = false }) {
    const context = {
        mode,
        prefixIdentifiers,
        sourceMap: sourceMap$1,
        filename,
        scopeId,
        optimizeImports,
        runtimeGlobalName,
        runtimeModuleName,
        ssr,
        source: ast.loc.source,
        code: ``,
        column: 1,
        line: 1,
        offset: 0,
        indentLevel: 0,
        pure: false,
        map: undefined,
        helper(key) {
            return `_${helperNameMap[key]}`;
        },
        push(code, node) {
            context.code += code;
            if ( context.map) {
                if (node) {
                    let name;
                    if (node.type === 4 /* SIMPLE_EXPRESSION */ && !node.isStatic) {
                        const content = node.content.replace(/^_ctx\./, '');
                        if (content !== node.content && isSimpleIdentifier(content)) {
                            name = content;
                        }
                    }
                    addMapping(node.loc.start, name);
                }
                advancePositionWithMutation(context, code);
                if (node && node.loc !== locStub) {
                    addMapping(node.loc.end);
                }
            }
        },
        indent() {
            newline(++context.indentLevel);
        },
        deindent(withoutNewLine = false) {
            if (withoutNewLine) {
                --context.indentLevel;
            }
            else {
                newline(--context.indentLevel);
            }
        },
        newline() {
            newline(context.indentLevel);
        }
    };
    function newline(n) {
        context.push('\n' + `  `.repeat(n));
    }
    function addMapping(loc, name) {
        context.map.addMapping({
            name,
            source: context.filename,
            original: {
                line: loc.line,
                column: loc.column - 1 // source-map column is 0 based
            },
            generated: {
                line: context.line,
                column: context.column - 1
            }
        });
    }
    if ( sourceMap$1) {
        // lazy require source-map implementation, only in non-browser builds
        context.map = new sourceMap.SourceMapGenerator();
        context.map.setSourceContent(filename, context.source);
    }
    return context;
}
function generate(ast, options = {}) {
    const context = createCodegenContext(ast, options);
    if (options.onContextCreated)
        options.onContextCreated(context);
    const { mode, push, prefixIdentifiers, indent, deindent, newline, scopeId, ssr } = context;
    const hasHelpers = ast.helpers.length > 0;
    const useWithBlock = !prefixIdentifiers && mode !== 'module';
    const genScopeId =  scopeId != null && mode === 'module';
    const isSetupInlined =  !!options.inline;
    // preambles
    // in setup() inline mode, the preamble is generated in a sub context
    // and returned separately.
    const preambleContext = isSetupInlined
        ? createCodegenContext(ast, options)
        : context;
    if ( mode === 'module') {
        genModulePreamble(ast, preambleContext, genScopeId, isSetupInlined);
    }
    else {
        genFunctionPreamble(ast, preambleContext);
    }
    // enter render function
    const functionName = ssr ? `ssrRender` : `render`;
    const args = ssr ? ['_ctx', '_push', '_parent', '_attrs'] : ['_ctx', '_cache'];
    if ( options.bindingMetadata && !options.inline) {
        // binding optimization args
        args.push('$props', '$setup', '$data', '$options');
    }
    const signature =  options.isTS
        ? args.map(arg => `${arg}: any`).join(',')
        : args.join(', ');
    if (genScopeId) {
        if (isSetupInlined) {
            push(`${PURE_ANNOTATION}_withId(`);
        }
        else {
            push(`const ${functionName} = ${PURE_ANNOTATION}_withId(`);
        }
    }
    if (isSetupInlined || genScopeId) {
        push(`(${signature}) => {`);
    }
    else {
        push(`function ${functionName}(${signature}) {`);
    }
    indent();
    if (useWithBlock) {
        push(`with (_ctx) {`);
        indent();
        // function mode const declarations should be inside with block
        // also they should be renamed to avoid collision with user properties
        if (hasHelpers) {
            push(`const { ${ast.helpers
                .map(s => `${helperNameMap[s]}: _${helperNameMap[s]}`)
                .join(', ')} } = _Vue`);
            push(`\n`);
            newline();
        }
    }
    // generate asset resolution statements
    if (ast.components.length) {
        genAssets(ast.components, 'component', context);
        if (ast.directives.length || ast.temps > 0) {
            newline();
        }
    }
    if (ast.directives.length) {
        genAssets(ast.directives, 'directive', context);
        if (ast.temps > 0) {
            newline();
        }
    }
    if (ast.temps > 0) {
        push(`let `);
        for (let i = 0; i < ast.temps; i++) {
            push(`${i > 0 ? `, ` : ``}_temp${i}`);
        }
    }
    if (ast.components.length || ast.directives.length || ast.temps) {
        push(`\n`);
        newline();
    }
    // generate the VNode tree expression
    if (!ssr) {
        push(`return `);
    }
    if (ast.codegenNode) {
        genNode(ast.codegenNode, context);
    }
    else {
        push(`null`);
    }
    if (useWithBlock) {
        deindent();
        push(`}`);
    }
    deindent();
    push(`}`);
    if (genScopeId) {
        push(`)`);
    }
    return {
        ast,
        code: context.code,
        preamble: isSetupInlined ? preambleContext.code : ``,
        // SourceMapGenerator does have toJSON() method but it's not in the types
        map: context.map ? context.map.toJSON() : undefined
    };
}
function genFunctionPreamble(ast, context) {
    const { ssr, prefixIdentifiers, push, newline, runtimeModuleName, runtimeGlobalName } = context;
    const VueBinding =  ssr
        ? `require(${JSON.stringify(runtimeModuleName)})`
        : runtimeGlobalName;
    const aliasHelper = (s) => `${helperNameMap[s]}: _${helperNameMap[s]}`;
    // Generate const declaration for helpers
    // In prefix mode, we place the const declaration at top so it's done
    // only once; But if we not prefixing, we place the declaration inside the
    // with block so it doesn't incur the `in` check cost for every helper access.
    if (ast.helpers.length > 0) {
        if ( prefixIdentifiers) {
            push(`const { ${ast.helpers.map(aliasHelper).join(', ')} } = ${VueBinding}\n`);
        }
        else {
            // "with" mode.
            // save Vue in a separate variable to avoid collision
            push(`const _Vue = ${VueBinding}\n`);
            // in "with" mode, helpers are declared inside the with block to avoid
            // has check cost, but hoists are lifted out of the function - we need
            // to provide the helper here.
            if (ast.hoists.length) {
                const staticHelpers = [
                    CREATE_VNODE,
                    CREATE_COMMENT,
                    CREATE_TEXT,
                    CREATE_STATIC
                ]
                    .filter(helper => ast.helpers.includes(helper))
                    .map(aliasHelper)
                    .join(', ');
                push(`const { ${staticHelpers} } = _Vue\n`);
            }
        }
    }
    // generate variables for ssr helpers
    if ( ast.ssrHelpers && ast.ssrHelpers.length) {
        // ssr guarantees prefixIdentifier: true
        push(`const { ${ast.ssrHelpers
            .map(aliasHelper)
            .join(', ')} } = require("@xlboy-v3/server-renderer")\n`);
    }
    genHoists(ast.hoists, context);
    newline();
    push(`return `);
}
function genModulePreamble(ast, context, genScopeId, inline) {
    const { push, helper, newline, scopeId, optimizeImports, runtimeModuleName } = context;
    if (genScopeId) {
        ast.helpers.push(WITH_SCOPE_ID);
        if (ast.hoists.length) {
            ast.helpers.push(PUSH_SCOPE_ID, POP_SCOPE_ID);
        }
    }
    // generate import statements for helpers
    if (ast.helpers.length) {
        if (optimizeImports) {
            // when bundled with webpack with code-split, calling an import binding
            // as a function leads to it being wrapped with `Object(a.b)` or `(0,a.b)`,
            // incurring both payload size increase and potential perf overhead.
            // therefore we assign the imports to variables (which is a constant ~50b
            // cost per-component instead of scaling with template size)
            push(`import { ${ast.helpers
                .map(s => helperNameMap[s])
                .join(', ')} } from ${JSON.stringify(runtimeModuleName)}\n`);
            push(`\n// Binding optimization for webpack code-split\nconst ${ast.helpers
                .map(s => `_${helperNameMap[s]} = ${helperNameMap[s]}`)
                .join(', ')}\n`);
        }
        else {
            push(`import { ${ast.helpers
                .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
                .join(', ')} } from ${JSON.stringify(runtimeModuleName)}\n`);
        }
    }
    if (ast.ssrHelpers && ast.ssrHelpers.length) {
        push(`import { ${ast.ssrHelpers
            .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
            .join(', ')} } from "@xlboy-v3/server-renderer"\n`);
    }
    if (ast.imports.length) {
        genImports(ast.imports, context);
        newline();
    }
    if (genScopeId) {
        push(`const _withId = ${PURE_ANNOTATION}${helper(WITH_SCOPE_ID)}("${scopeId}")`);
        newline();
    }
    genHoists(ast.hoists, context);
    newline();
    if (!inline) {
        push(`export `);
    }
}
function genAssets(assets, type, { helper, push, newline }) {
    const resolver = helper(type === 'component' ? RESOLVE_COMPONENT : RESOLVE_DIRECTIVE);
    for (let i = 0; i < assets.length; i++) {
        const id = assets[i];
        push(`const ${toValidAssetId(id, type)} = ${resolver}(${JSON.stringify(id)})`);
        if (i < assets.length - 1) {
            newline();
        }
    }
}
function genHoists(hoists, context) {
    if (!hoists.length) {
        return;
    }
    context.pure = true;
    const { push, newline, helper, scopeId, mode } = context;
    const genScopeId =  scopeId != null && mode !== 'function';
    newline();
    // push scope Id before initializing hoisted vnodes so that these vnodes
    // get the proper scopeId as well.
    if (genScopeId) {
        push(`${helper(PUSH_SCOPE_ID)}("${scopeId}")`);
        newline();
    }
    hoists.forEach((exp, i) => {
        if (exp) {
            push(`const _hoisted_${i + 1} = `);
            genNode(exp, context);
            newline();
        }
    });
    if (genScopeId) {
        push(`${helper(POP_SCOPE_ID)}()`);
        newline();
    }
    context.pure = false;
}
function genImports(importsOptions, context) {
    if (!importsOptions.length) {
        return;
    }
    importsOptions.forEach(imports => {
        context.push(`import `);
        genNode(imports.exp, context);
        context.push(` from '${imports.path}'`);
        context.newline();
    });
}
function isText$1(n) {
    return (isString(n) ||
        n.type === 4 /* SIMPLE_EXPRESSION */ ||
        n.type === 2 /* TEXT */ ||
        n.type === 5 /* INTERPOLATION */ ||
        n.type === 8 /* COMPOUND_EXPRESSION */);
}
function genNodeListAsArray(nodes, context) {
    const multilines = nodes.length > 3 ||
        ( nodes.some(n => isArray(n) || !isText$1(n)));
    context.push(`[`);
    multilines && context.indent();
    genNodeList(nodes, context, multilines);
    multilines && context.deindent();
    context.push(`]`);
}
function genNodeList(nodes, context, multilines = false, comma = true) {
    const { push, newline } = context;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (isString(node)) {
            push(node);
        }
        else if (isArray(node)) {
            genNodeListAsArray(node, context);
        }
        else {
            genNode(node, context);
        }
        if (i < nodes.length - 1) {
            if (multilines) {
                comma && push(',');
                newline();
            }
            else {
                comma && push(', ');
            }
        }
    }
}
function genNode(node, context) {
    if (isString(node)) {
        context.push(node);
        return;
    }
    if (isSymbol(node)) {
        context.push(context.helper(node));
        return;
    }
    switch (node.type) {
        case 1 /* ELEMENT */:
        case 9 /* IF */:
        case 11 /* FOR */:
            
                assert(node.codegenNode != null, `Codegen node is missing for element/if/for node. ` +
                    `Apply appropriate transforms first.`);
            genNode(node.codegenNode, context);
            break;
        case 2 /* TEXT */:
            genText(node, context);
            break;
        case 4 /* SIMPLE_EXPRESSION */:
            genExpression(node, context);
            break;
        case 5 /* INTERPOLATION */:
            genInterpolation(node, context);
            break;
        case 12 /* TEXT_CALL */:
            genNode(node.codegenNode, context);
            break;
        case 8 /* COMPOUND_EXPRESSION */:
            genCompoundExpression(node, context);
            break;
        case 3 /* COMMENT */:
            genComment(node, context);
            break;
        case 13 /* VNODE_CALL */:
            genVNodeCall(node, context);
            break;
        case 14 /* JS_CALL_EXPRESSION */:
            genCallExpression(node, context);
            break;
        case 15 /* JS_OBJECT_EXPRESSION */:
            genObjectExpression(node, context);
            break;
        case 17 /* JS_ARRAY_EXPRESSION */:
            genArrayExpression(node, context);
            break;
        case 18 /* JS_FUNCTION_EXPRESSION */:
            genFunctionExpression(node, context);
            break;
        case 19 /* JS_CONDITIONAL_EXPRESSION */:
            genConditionalExpression(node, context);
            break;
        case 20 /* JS_CACHE_EXPRESSION */:
            genCacheExpression(node, context);
            break;
        // SSR only types
        case 21 /* JS_BLOCK_STATEMENT */:
             genNodeList(node.body, context, true, false);
            break;
        case 22 /* JS_TEMPLATE_LITERAL */:
             genTemplateLiteral(node, context);
            break;
        case 23 /* JS_IF_STATEMENT */:
             genIfStatement(node, context);
            break;
        case 24 /* JS_ASSIGNMENT_EXPRESSION */:
             genAssignmentExpression(node, context);
            break;
        case 25 /* JS_SEQUENCE_EXPRESSION */:
             genSequenceExpression(node, context);
            break;
        case 26 /* JS_RETURN_STATEMENT */:
             genReturnStatement(node, context);
            break;
        /* istanbul ignore next */
        case 10 /* IF_BRANCH */:
            // noop
            break;
        default:
            {
                assert(false, `unhandled codegen node type: ${node.type}`);
                // make sure we exhaust all possible types
                const exhaustiveCheck = node;
                return exhaustiveCheck;
            }
    }
}
function genText(node, context) {
    context.push(JSON.stringify(node.content), node);
}
function genExpression(node, context) {
    const { content, isStatic } = node;
    context.push(isStatic ? JSON.stringify(content) : content, node);
}
function genInterpolation(node, context) {
    const { push, helper, pure } = context;
    if (pure)
        push(PURE_ANNOTATION);
    push(`${helper(TO_DISPLAY_STRING)}(`);
    genNode(node.content, context);
    push(`)`);
}
function genCompoundExpression(node, context) {
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (isString(child)) {
            context.push(child);
        }
        else {
            genNode(child, context);
        }
    }
}
function genExpressionAsPropertyKey(node, context) {
    const { push } = context;
    if (node.type === 8 /* COMPOUND_EXPRESSION */) {
        push(`[`);
        genCompoundExpression(node, context);
        push(`]`);
    }
    else if (node.isStatic) {
        // only quote keys if necessary
        const text = isSimpleIdentifier(node.content)
            ? node.content
            : JSON.stringify(node.content);
        push(text, node);
    }
    else {
        push(`[${node.content}]`, node);
    }
}
function genComment(node, context) {
    {
        const { push, helper, pure } = context;
        if (pure) {
            push(PURE_ANNOTATION);
        }
        push(`${helper(CREATE_COMMENT)}(${JSON.stringify(node.content)})`, node);
    }
}
function genVNodeCall(node, context) {
    const { push, helper, pure } = context;
    const { tag, props, children, patchFlag, dynamicProps, directives, isBlock, disableTracking } = node;
    if (directives) {
        push(helper(WITH_DIRECTIVES) + `(`);
    }
    if (isBlock) {
        push(`(${helper(OPEN_BLOCK)}(${disableTracking ? `true` : ``}), `);
    }
    if (pure) {
        push(PURE_ANNOTATION);
    }
    push(helper(isBlock ? CREATE_BLOCK : CREATE_VNODE) + `(`, node);
    genNodeList(genNullableArgs([tag, props, children, patchFlag, dynamicProps]), context);
    push(`)`);
    if (isBlock) {
        push(`)`);
    }
    if (directives) {
        push(`, `);
        genNode(directives, context);
        push(`)`);
    }
}
function genNullableArgs(args) {
    let i = args.length;
    while (i--) {
        if (args[i] != null)
            break;
    }
    return args.slice(0, i + 1).map(arg => arg || `null`);
}
// JavaScript
function genCallExpression(node, context) {
    const { push, helper, pure } = context;
    const callee = isString(node.callee) ? node.callee : helper(node.callee);
    if (pure) {
        push(PURE_ANNOTATION);
    }
    push(callee + `(`, node);
    genNodeList(node.arguments, context);
    push(`)`);
}
function genObjectExpression(node, context) {
    const { push, indent, deindent, newline } = context;
    const { properties } = node;
    if (!properties.length) {
        push(`{}`, node);
        return;
    }
    const multilines = properties.length > 1 ||
        (
            properties.some(p => p.value.type !== 4 /* SIMPLE_EXPRESSION */));
    push(multilines ? `{` : `{ `);
    multilines && indent();
    for (let i = 0; i < properties.length; i++) {
        const { key, value } = properties[i];
        // key
        genExpressionAsPropertyKey(key, context);
        push(`: `);
        // value
        genNode(value, context);
        if (i < properties.length - 1) {
            // will only reach this if it's multilines
            push(`,`);
            newline();
        }
    }
    multilines && deindent();
    push(multilines ? `}` : ` }`);
}
function genArrayExpression(node, context) {
    genNodeListAsArray(node.elements, context);
}
function genFunctionExpression(node, context) {
    const { push, indent, deindent, scopeId, mode } = context;
    const { params, returns, body, newline, isSlot } = node;
    // slot functions also need to push scopeId before rendering its content
    const genScopeId =  isSlot && scopeId != null && mode !== 'function';
    if (genScopeId) {
        push(`_withId(`);
    }
    else if (isSlot) {
        push(`_${helperNameMap[WITH_CTX]}(`);
    }
    push(`(`, node);
    if (isArray(params)) {
        genNodeList(params, context);
    }
    else if (params) {
        genNode(params, context);
    }
    push(`) => `);
    if (newline || body) {
        push(`{`);
        indent();
    }
    if (returns) {
        if (newline) {
            push(`return `);
        }
        if (isArray(returns)) {
            genNodeListAsArray(returns, context);
        }
        else {
            genNode(returns, context);
        }
    }
    else if (body) {
        genNode(body, context);
    }
    if (newline || body) {
        deindent();
        push(`}`);
    }
    if (genScopeId || isSlot) {
        push(`)`);
    }
}
function genConditionalExpression(node, context) {
    const { test, consequent, alternate, newline: needNewline } = node;
    const { push, indent, deindent, newline } = context;
    if (test.type === 4 /* SIMPLE_EXPRESSION */) {
        const needsParens = !isSimpleIdentifier(test.content);
        needsParens && push(`(`);
        genExpression(test, context);
        needsParens && push(`)`);
    }
    else {
        push(`(`);
        genNode(test, context);
        push(`)`);
    }
    needNewline && indent();
    context.indentLevel++;
    needNewline || push(` `);
    push(`? `);
    genNode(consequent, context);
    context.indentLevel--;
    needNewline && newline();
    needNewline || push(` `);
    push(`: `);
    const isNested = alternate.type === 19 /* JS_CONDITIONAL_EXPRESSION */;
    if (!isNested) {
        context.indentLevel++;
    }
    genNode(alternate, context);
    if (!isNested) {
        context.indentLevel--;
    }
    needNewline && deindent(true /* without newline */);
}
function genCacheExpression(node, context) {
    const { push, helper, indent, deindent, newline } = context;
    push(`_cache[${node.index}] || (`);
    if (node.isVNode) {
        indent();
        push(`${helper(SET_BLOCK_TRACKING)}(-1),`);
        newline();
    }
    push(`_cache[${node.index}] = `);
    genNode(node.value, context);
    if (node.isVNode) {
        push(`,`);
        newline();
        push(`${helper(SET_BLOCK_TRACKING)}(1),`);
        newline();
        push(`_cache[${node.index}]`);
        deindent();
    }
    push(`)`);
}
function genTemplateLiteral(node, context) {
    const { push, indent, deindent } = context;
    push('`');
    const l = node.elements.length;
    const multilines = l > 3;
    for (let i = 0; i < l; i++) {
        const e = node.elements[i];
        if (isString(e)) {
            push(e.replace(/(`|\$|\\)/g, '\\$1'));
        }
        else {
            push('${');
            if (multilines)
                indent();
            genNode(e, context);
            if (multilines)
                deindent();
            push('}');
        }
    }
    push('`');
}
function genIfStatement(node, context) {
    const { push, indent, deindent } = context;
    const { test, consequent, alternate } = node;
    push(`if (`);
    genNode(test, context);
    push(`) {`);
    indent();
    genNode(consequent, context);
    deindent();
    push(`}`);
    if (alternate) {
        push(` else `);
        if (alternate.type === 23 /* JS_IF_STATEMENT */) {
            genIfStatement(alternate, context);
        }
        else {
            push(`{`);
            indent();
            genNode(alternate, context);
            deindent();
            push(`}`);
        }
    }
}
function genAssignmentExpression(node, context) {
    genNode(node.left, context);
    context.push(` = `);
    genNode(node.right, context);
}
function genSequenceExpression(node, context) {
    context.push(`(`);
    genNodeList(node.expressions, context);
    context.push(`)`);
}
function genReturnStatement({ returns }, context) {
    context.push(`return `);
    if (isArray(returns)) {
        genNodeListAsArray(returns, context);
    }
    else {
        genNode(returns, context);
    }
}

const isLiteralWhitelisted = /*#__PURE__*/ makeMap('true,false,null,this');
const transformExpression = (node, context) => {
    if (node.type === 5 /* INTERPOLATION */) {
        node.content = processExpression(node.content, context);
    }
    else if (node.type === 1 /* ELEMENT */) {
        // handle directives on element
        for (let i = 0; i < node.props.length; i++) {
            const dir = node.props[i];
            // do not process for v-on & v-for since they are special handled
            if (dir.type === 7 /* DIRECTIVE */ && dir.name !== 'for') {
                const exp = dir.exp;
                const arg = dir.arg;
                // do not process exp if this is v-on:arg - we need special handling
                // for wrapping inline statements.
                if (exp &&
                    exp.type === 4 /* SIMPLE_EXPRESSION */ &&
                    !(dir.name === 'on' && arg)) {
                    dir.exp = processExpression(exp, context, 
                    // slot args must be processed as function params
                    dir.name === 'slot');
                }
                if (arg && arg.type === 4 /* SIMPLE_EXPRESSION */ && !arg.isStatic) {
                    dir.arg = processExpression(arg, context);
                }
            }
        }
    }
};
// Important: since this function uses Node.js only dependencies, it should
// always be used with a leading !false check so that it can be
// tree-shaken from the browser build.
function processExpression(node, context, 
// some expressions like v-slot props & v-for aliases should be parsed as
// function params
asParams = false, 
// v-on handler values may contain multiple statements
asRawStatements = false) {
    if (!context.prefixIdentifiers || !node.content.trim()) {
        return node;
    }
    const { inline, bindingMetadata } = context;
    const rewriteIdentifier = (raw, parent, id) => {
        const type = hasOwn(bindingMetadata, raw) && bindingMetadata[raw];
        if (inline) {
            // x = y
            const isAssignmentLVal = parent && parent.type === 'AssignmentExpression' && parent.left === id;
            // x++
            const isUpdateArg = parent && parent.type === 'UpdateExpression' && parent.argument === id;
            // ({ x } = y)
            const isDestructureAssignment = parent && isInDestructureAssignment(parent, parentStack);
            if (type === "setup-const" /* SETUP_CONST */) {
                return raw;
            }
            else if (type === "setup-ref" /* SETUP_REF */) {
                return `${raw}.value`;
            }
            else if (type === "setup-maybe-ref" /* SETUP_MAYBE_REF */) {
                // const binding that may or may not be ref
                // if it's not a ref, then assignments don't make sense -
                // so we ignore the non-ref assignment case and generate code
                // that assumes the value to be a ref for more efficiency
                return isAssignmentLVal || isUpdateArg || isDestructureAssignment
                    ? `${raw}.value`
                    : `${context.helperString(UNREF)}(${raw})`;
            }
            else if (type === "setup-let" /* SETUP_LET */) {
                if (isAssignmentLVal) {
                    // let binding.
                    // this is a bit more tricky as we need to cover the case where
                    // let is a local non-ref value, and we need to replicate the
                    // right hand side value.
                    // x = y --> isRef(x) ? x.value = y : x = y
                    const rVal = parent.right;
                    const rExp = rawExp.slice(rVal.start - 1, rVal.end - 1);
                    const rExpString = stringifyExpression(processExpression(createSimpleExpression(rExp, false), context));
                    return `${context.helperString(IS_REF)}(${raw})${context.isTS ? ` //@ts-ignore\n` : ``} ? ${raw}.value = ${rExpString} : ${raw}`;
                }
                else if (isUpdateArg) {
                    // make id replace parent in the code range so the raw update operator
                    // is removed
                    id.start = parent.start;
                    id.end = parent.end;
                    const { prefix: isPrefix, operator } = parent;
                    const prefix = isPrefix ? operator : ``;
                    const postfix = isPrefix ? `` : operator;
                    // let binding.
                    // x++ --> isRef(a) ? a.value++ : a++
                    return `${context.helperString(IS_REF)}(${raw})${context.isTS ? ` //@ts-ignore\n` : ``} ? ${prefix}${raw}.value${postfix} : ${prefix}${raw}${postfix}`;
                }
                else if (isDestructureAssignment) {
                    // TODO
                    // let binding in a destructure assignment - it's very tricky to
                    // handle both possible cases here without altering the original
                    // structure of the code, so we just assume it's not a ref here
                    // for now
                    return raw;
                }
                else {
                    return `${context.helperString(UNREF)}(${raw})`;
                }
            }
            else if (type === "props" /* PROPS */) {
                // use __props which is generated by compileScript so in ts mode
                // it gets correct type
                return `__props.${raw}`;
            }
        }
        else {
            if (type && type.startsWith('setup')) {
                // setup bindings in non-inline mode
                return `$setup.${raw}`;
            }
            else if (type) {
                return `$${type}.${raw}`;
            }
        }
        // fallback to ctx
        return `_ctx.${raw}`;
    };
    // fast path if expression is a simple identifier.
    const rawExp = node.content;
    // bail constant on parens (function invocation) and dot (member access)
    const bailConstant = rawExp.indexOf(`(`) > -1 || rawExp.indexOf('.') > 0;
    if (isSimpleIdentifier(rawExp)) {
        const isScopeVarReference = context.identifiers[rawExp];
        const isAllowedGlobal = isGloballyWhitelisted(rawExp);
        const isLiteral = isLiteralWhitelisted(rawExp);
        if (!asParams && !isScopeVarReference && !isAllowedGlobal && !isLiteral) {
            // const bindings exposed from setup can be skipped for patching but
            // cannot be hoisted to module scope
            if (bindingMetadata[node.content] === "setup-const" /* SETUP_CONST */) {
                node.constType = 1 /* CAN_SKIP_PATCH */;
            }
            node.content = rewriteIdentifier(rawExp);
        }
        else if (!isScopeVarReference) {
            if (isLiteral) {
                node.constType = 3 /* CAN_STRINGIFY */;
            }
            else {
                node.constType = 2 /* CAN_HOIST */;
            }
        }
        return node;
    }
    let ast;
    // exp needs to be parsed differently:
    // 1. Multiple inline statements (v-on, with presence of `;`): parse as raw
    //    exp, but make sure to pad with spaces for consistent ranges
    // 2. Expressions: wrap with parens (for e.g. object expressions)
    // 3. Function arguments (v-for, v-slot): place in a function argument position
    const source = asRawStatements
        ? ` ${rawExp} `
        : `(${rawExp})${asParams ? `=>{}` : ``}`;
    try {
        ast = parser.parse(source, {
            plugins: [...context.expressionPlugins, ...babelParserDefaultPlugins]
        }).program;
    }
    catch (e) {
        context.onError(createCompilerError(43 /* X_INVALID_EXPRESSION */, node.loc, undefined, e.message));
        return node;
    }
    const ids = [];
    const knownIds = Object.create(context.identifiers);
    const isDuplicate = (node) => ids.some(id => id.start === node.start);
    const parentStack = [];
    estreeWalker.walk(ast, {
        enter(node, parent) {
            parent && parentStack.push(parent);
            if (node.type === 'Identifier') {
                if (!isDuplicate(node)) {
                    const needPrefix = shouldPrefix(node, parent, parentStack);
                    if (!knownIds[node.name] && needPrefix) {
                        if (isStaticProperty(parent) && parent.shorthand) {
                            // property shorthand like { foo }, we need to add the key since
                            // we rewrite the value
                            node.prefix = `${node.name}: `;
                        }
                        node.name = rewriteIdentifier(node.name, parent, node);
                        ids.push(node);
                    }
                    else if (!isStaticPropertyKey(node, parent)) {
                        // The identifier is considered constant unless it's pointing to a
                        // scope variable (a v-for alias, or a v-slot prop)
                        if (!(needPrefix && knownIds[node.name]) && !bailConstant) {
                            node.isConstant = true;
                        }
                        // also generate sub-expressions for other identifiers for better
                        // source map support. (except for property keys which are static)
                        ids.push(node);
                    }
                }
            }
            else if (isFunction$1(node)) {
                // walk function expressions and add its arguments to known identifiers
                // so that we don't prefix them
                node.params.forEach(p => estreeWalker.walk(p, {
                    enter(child, parent) {
                        if (child.type === 'Identifier' &&
                            // do not record as scope variable if is a destructured key
                            !isStaticPropertyKey(child, parent) &&
                            // do not record if this is a default value
                            // assignment of a destructured variable
                            !(parent &&
                                parent.type === 'AssignmentPattern' &&
                                parent.right === child)) {
                            const { name } = child;
                            if (node.scopeIds && node.scopeIds.has(name)) {
                                return;
                            }
                            if (name in knownIds) {
                                knownIds[name]++;
                            }
                            else {
                                knownIds[name] = 1;
                            }
                            (node.scopeIds || (node.scopeIds = new Set())).add(name);
                        }
                    }
                }));
            }
        },
        leave(node, parent) {
            parent && parentStack.pop();
            if (node !== ast.body[0].expression && node.scopeIds) {
                node.scopeIds.forEach((id) => {
                    knownIds[id]--;
                    if (knownIds[id] === 0) {
                        delete knownIds[id];
                    }
                });
            }
        }
    });
    // We break up the compound expression into an array of strings and sub
    // expressions (for identifiers that have been prefixed). In codegen, if
    // an ExpressionNode has the `.children` property, it will be used instead of
    // `.content`.
    const children = [];
    ids.sort((a, b) => a.start - b.start);
    ids.forEach((id, i) => {
        // range is offset by -1 due to the wrapping parens when parsed
        const start = id.start - 1;
        const end = id.end - 1;
        const last = ids[i - 1];
        const leadingText = rawExp.slice(last ? last.end - 1 : 0, start);
        if (leadingText.length || id.prefix) {
            children.push(leadingText + (id.prefix || ``));
        }
        const source = rawExp.slice(start, end);
        children.push(createSimpleExpression(id.name, false, {
            source,
            start: advancePositionWithClone(node.loc.start, source, start),
            end: advancePositionWithClone(node.loc.start, source, end)
        }, id.isConstant ? 3 /* CAN_STRINGIFY */ : 0 /* NOT_CONSTANT */));
        if (i === ids.length - 1 && end < rawExp.length) {
            children.push(rawExp.slice(end));
        }
    });
    let ret;
    if (children.length) {
        ret = createCompoundExpression(children, node.loc);
    }
    else {
        ret = node;
        ret.constType = bailConstant
            ? 0 /* NOT_CONSTANT */
            : 3 /* CAN_STRINGIFY */;
    }
    ret.identifiers = Object.keys(knownIds);
    return ret;
}
const isFunction$1 = (node) => {
    return /Function(?:Expression|Declaration)$|Method$/.test(node.type);
};
const isStaticProperty = (node) => node &&
    (node.type === 'ObjectProperty' || node.type === 'ObjectMethod') &&
    !node.computed;
const isStaticPropertyKey = (node, parent) => isStaticProperty(parent) && parent.key === node;
function shouldPrefix(id, parent, parentStack) {
    // declaration id
    if ((parent.type === 'VariableDeclarator' ||
        parent.type === 'ClassDeclaration') &&
        parent.id === id) {
        return false;
    }
    if (isFunction$1(parent)) {
        // function decalration/expression id
        if (parent.id === id) {
            return false;
        }
        // params list
        if (parent.params.includes(id)) {
            return false;
        }
    }
    // property key
    // this also covers object destructure pattern
    if (isStaticPropertyKey(id, parent)) {
        return false;
    }
    // non-assignment array destructure pattern
    if (parent.type === 'ArrayPattern' &&
        !isInDestructureAssignment(parent, parentStack)) {
        return false;
    }
    // member expression property
    if ((parent.type === 'MemberExpression' ||
        parent.type === 'OptionalMemberExpression') &&
        parent.property === id &&
        !parent.computed) {
        return false;
    }
    // is a special keyword but parsed as identifier
    if (id.name === 'arguments') {
        return false;
    }
    // skip whitelisted globals
    if (isGloballyWhitelisted(id.name)) {
        return false;
    }
    // special case for webpack compilation
    if (id.name === 'require') {
        return false;
    }
    return true;
}
function isInDestructureAssignment(parent, parentStack) {
    if (parent &&
        (parent.type === 'ObjectProperty' || parent.type === 'ArrayPattern')) {
        let i = parentStack.length;
        while (i--) {
            const p = parentStack[i];
            if (p.type === 'AssignmentExpression') {
                return true;
            }
            else if (p.type !== 'ObjectProperty' && !p.type.endsWith('Pattern')) {
                break;
            }
        }
    }
    return false;
}
function stringifyExpression(exp) {
    if (isString(exp)) {
        return exp;
    }
    else if (exp.type === 4 /* SIMPLE_EXPRESSION */) {
        return exp.content;
    }
    else {
        return exp.children
            .map(stringifyExpression)
            .join('');
    }
}

const transformIf = createStructuralDirectiveTransform(/^(if|else|else-if)$/, (node, dir, context) => {
    return processIf(node, dir, context, (ifNode, branch, isRoot) => {
        // #1587: We need to dynamically increment the key based on the current
        // node's sibling nodes, since chained v-if/else branches are
        // rendered at the same depth
        const siblings = context.parent.children;
        let i = siblings.indexOf(ifNode);
        let key = 0;
        while (i-- >= 0) {
            const sibling = siblings[i];
            if (sibling && sibling.type === 9 /* IF */) {
                key += sibling.branches.length;
            }
        }
        // Exit callback. Complete the codegenNode when all children have been
        // transformed.
        return () => {
            if (isRoot) {
                ifNode.codegenNode = createCodegenNodeForBranch(branch, key, context);
            }
            else {
                // attach this branch's codegen node to the v-if root.
                const parentCondition = getParentCondition(ifNode.codegenNode);
                parentCondition.alternate = createCodegenNodeForBranch(branch, key + ifNode.branches.length - 1, context);
            }
        };
    });
});
// target-agnostic transform used for both Client and SSR
function processIf(node, dir, context, processCodegen) {
    if (dir.name !== 'else' &&
        (!dir.exp || !dir.exp.content.trim())) {
        const loc = dir.exp ? dir.exp.loc : node.loc;
        context.onError(createCompilerError(27 /* X_V_IF_NO_EXPRESSION */, dir.loc));
        dir.exp = createSimpleExpression(`true`, false, loc);
    }
    if ( context.prefixIdentifiers && dir.exp) {
        // dir.exp can only be simple expression because vIf transform is applied
        // before expression transform.
        dir.exp = processExpression(dir.exp, context);
    }
    if (dir.name === 'if') {
        const branch = createIfBranch(node, dir);
        const ifNode = {
            type: 9 /* IF */,
            loc: node.loc,
            branches: [branch]
        };
        context.replaceNode(ifNode);
        if (processCodegen) {
            return processCodegen(ifNode, branch, true);
        }
    }
    else {
        // locate the adjacent v-if
        const siblings = context.parent.children;
        const comments = [];
        let i = siblings.indexOf(node);
        while (i-- >= -1) {
            const sibling = siblings[i];
            if ( sibling && sibling.type === 3 /* COMMENT */) {
                context.removeNode(sibling);
                comments.unshift(sibling);
                continue;
            }
            if (sibling &&
                sibling.type === 2 /* TEXT */ &&
                !sibling.content.trim().length) {
                context.removeNode(sibling);
                continue;
            }
            if (sibling && sibling.type === 9 /* IF */) {
                // move the node to the if node's branches
                context.removeNode();
                const branch = createIfBranch(node, dir);
                if ( comments.length) {
                    branch.children = [...comments, ...branch.children];
                }
                // check if user is forcing same key on different branches
                {
                    const key = branch.userKey;
                    if (key) {
                        sibling.branches.forEach(({ userKey }) => {
                            if (isSameKey(userKey, key)) {
                                context.onError(createCompilerError(28 /* X_V_IF_SAME_KEY */, branch.userKey.loc));
                            }
                        });
                    }
                }
                sibling.branches.push(branch);
                const onExit = processCodegen && processCodegen(sibling, branch, false);
                // since the branch was removed, it will not be traversed.
                // make sure to traverse here.
                traverseNode(branch, context);
                // call on exit
                if (onExit)
                    onExit();
                // make sure to reset currentNode after traversal to indicate this
                // node has been removed.
                context.currentNode = null;
            }
            else {
                context.onError(createCompilerError(29 /* X_V_ELSE_NO_ADJACENT_IF */, node.loc));
            }
            break;
        }
    }
}
function createIfBranch(node, dir) {
    return {
        type: 10 /* IF_BRANCH */,
        loc: node.loc,
        condition: dir.name === 'else' ? undefined : dir.exp,
        children: node.tagType === 3 /* TEMPLATE */ && !findDir(node, 'for')
            ? node.children
            : [node],
        userKey: findProp(node, `key`)
    };
}
function createCodegenNodeForBranch(branch, keyIndex, context) {
    if (branch.condition) {
        return createConditionalExpression(branch.condition, createChildrenCodegenNode(branch, keyIndex, context), 
        // make sure to pass in asBlock: true so that the comment node call
        // closes the current block.
        createCallExpression(context.helper(CREATE_COMMENT), [
             '"v-if"' ,
            'true'
        ]));
    }
    else {
        return createChildrenCodegenNode(branch, keyIndex, context);
    }
}
function createChildrenCodegenNode(branch, keyIndex, context) {
    const { helper } = context;
    const keyProperty = createObjectProperty(`key`, createSimpleExpression(`${keyIndex}`, false, locStub, 2 /* CAN_HOIST */));
    const { children } = branch;
    const firstChild = children[0];
    const needFragmentWrapper = children.length !== 1 || firstChild.type !== 1 /* ELEMENT */;
    if (needFragmentWrapper) {
        if (children.length === 1 && firstChild.type === 11 /* FOR */) {
            // optimize away nested fragments when child is a ForNode
            const vnodeCall = firstChild.codegenNode;
            injectProp(vnodeCall, keyProperty, context);
            return vnodeCall;
        }
        else {
            return createVNodeCall(context, helper(FRAGMENT), createObjectExpression([keyProperty]), children, 64 /* STABLE_FRAGMENT */ +
                ( ` /* ${PatchFlagNames[64 /* STABLE_FRAGMENT */]} */`
                    ), undefined, undefined, true, false, branch.loc);
        }
    }
    else {
        const vnodeCall = firstChild
            .codegenNode;
        // Change createVNode to createBlock.
        if (vnodeCall.type === 13 /* VNODE_CALL */) {
            vnodeCall.isBlock = true;
            helper(OPEN_BLOCK);
            helper(CREATE_BLOCK);
        }
        // inject branch key
        injectProp(vnodeCall, keyProperty, context);
        return vnodeCall;
    }
}
function isSameKey(a, b) {
    if (!a || a.type !== b.type) {
        return false;
    }
    if (a.type === 6 /* ATTRIBUTE */) {
        if (a.value.content !== b.value.content) {
            return false;
        }
    }
    else {
        // directive
        const exp = a.exp;
        const branchExp = b.exp;
        if (exp.type !== branchExp.type) {
            return false;
        }
        if (exp.type !== 4 /* SIMPLE_EXPRESSION */ ||
            (exp.isStatic !== branchExp.isStatic ||
                exp.content !== branchExp.content)) {
            return false;
        }
    }
    return true;
}
function getParentCondition(node) {
    while (true) {
        if (node.type === 19 /* JS_CONDITIONAL_EXPRESSION */) {
            if (node.alternate.type === 19 /* JS_CONDITIONAL_EXPRESSION */) {
                node = node.alternate;
            }
            else {
                return node;
            }
        }
        else if (node.type === 20 /* JS_CACHE_EXPRESSION */) {
            node = node.value;
        }
    }
}

const transformFor = createStructuralDirectiveTransform('for', (node, dir, context) => {
    const { helper } = context;
    return processFor(node, dir, context, forNode => {
        // create the loop render function expression now, and add the
        // iterator on exit after all children have been traversed
        const renderExp = createCallExpression(helper(RENDER_LIST), [
            forNode.source
        ]);
        const keyProp = findProp(node, `key`);
        const keyProperty = keyProp
            ? createObjectProperty(`key`, keyProp.type === 6 /* ATTRIBUTE */
                ? createSimpleExpression(keyProp.value.content, true)
                : keyProp.exp)
            : null;
        if ( context.prefixIdentifiers && keyProperty) {
            // #2085 process :key expression needs to be processed in order for it
            // to behave consistently for <template v-for> and <div v-for>.
            // In the case of `<template v-for>`, the node is discarded and never
            // traversed so its key expression won't be processed by the normal
            // transforms.
            keyProperty.value = processExpression(keyProperty.value, context);
        }
        const isStableFragment = forNode.source.type === 4 /* SIMPLE_EXPRESSION */ &&
            forNode.source.constType > 0;
        const fragmentFlag = isStableFragment
            ? 64 /* STABLE_FRAGMENT */
            : keyProp
                ? 128 /* KEYED_FRAGMENT */
                : 256 /* UNKEYED_FRAGMENT */;
        forNode.codegenNode = createVNodeCall(context, helper(FRAGMENT), undefined, renderExp, fragmentFlag +
            ( ` /* ${PatchFlagNames[fragmentFlag]} */` ), undefined, undefined, true /* isBlock */, !isStableFragment /* disableTracking */, node.loc);
        return () => {
            // finish the codegen now that all children have been traversed
            let childBlock;
            const isTemplate = isTemplateNode(node);
            const { children } = forNode;
            // check <template v-for> key placement
            if ( isTemplate) {
                node.children.some(c => {
                    if (c.type === 1 /* ELEMENT */) {
                        const key = findProp(c, 'key');
                        if (key) {
                            context.onError(createCompilerError(32 /* X_V_FOR_TEMPLATE_KEY_PLACEMENT */, key.loc));
                            return true;
                        }
                    }
                });
            }
            const needFragmentWrapper = children.length !== 1 || children[0].type !== 1 /* ELEMENT */;
            const slotOutlet = isSlotOutlet(node)
                ? node
                : isTemplate &&
                    node.children.length === 1 &&
                    isSlotOutlet(node.children[0])
                    ? node.children[0] // api-extractor somehow fails to infer this
                    : null;
            if (slotOutlet) {
                // <slot v-for="..."> or <template v-for="..."><slot/></template>
                childBlock = slotOutlet.codegenNode;
                if (isTemplate && keyProperty) {
                    // <template v-for="..." :key="..."><slot/></template>
                    // we need to inject the key to the renderSlot() call.
                    // the props for renderSlot is passed as the 3rd argument.
                    injectProp(childBlock, keyProperty, context);
                }
            }
            else if (needFragmentWrapper) {
                // <template v-for="..."> with text or multi-elements
                // should generate a fragment block for each loop
                childBlock = createVNodeCall(context, helper(FRAGMENT), keyProperty ? createObjectExpression([keyProperty]) : undefined, node.children, 64 /* STABLE_FRAGMENT */ +
                    ( ` /* ${PatchFlagNames[64 /* STABLE_FRAGMENT */]} */`
                        ), undefined, undefined, true);
            }
            else {
                // Normal element v-for. Directly use the child's codegenNode
                // but mark it as a block.
                childBlock = children[0]
                    .codegenNode;
                if (isTemplate && keyProperty) {
                    injectProp(childBlock, keyProperty, context);
                }
                childBlock.isBlock = !isStableFragment;
                if (childBlock.isBlock) {
                    helper(OPEN_BLOCK);
                    helper(CREATE_BLOCK);
                }
                else {
                    helper(CREATE_VNODE);
                }
            }
            renderExp.arguments.push(createFunctionExpression(createForLoopParams(forNode.parseResult), childBlock, true /* force newline */));
        };
    });
});
// target-agnostic transform used for both Client and SSR
function processFor(node, dir, context, processCodegen) {
    if (!dir.exp) {
        context.onError(createCompilerError(30 /* X_V_FOR_NO_EXPRESSION */, dir.loc));
        return;
    }
    const parseResult = parseForExpression(
    // can only be simple expression because vFor transform is applied
    // before expression transform.
    dir.exp, context);
    if (!parseResult) {
        context.onError(createCompilerError(31 /* X_V_FOR_MALFORMED_EXPRESSION */, dir.loc));
        return;
    }
    const { addIdentifiers, removeIdentifiers, scopes } = context;
    const { source, value, key, index } = parseResult;
    const forNode = {
        type: 11 /* FOR */,
        loc: dir.loc,
        source,
        valueAlias: value,
        keyAlias: key,
        objectIndexAlias: index,
        parseResult,
        children: isTemplateNode(node) ? node.children : [node]
    };
    context.replaceNode(forNode);
    // bookkeeping
    scopes.vFor++;
    if ( context.prefixIdentifiers) {
        // scope management
        // inject identifiers to context
        value && addIdentifiers(value);
        key && addIdentifiers(key);
        index && addIdentifiers(index);
    }
    const onExit = processCodegen && processCodegen(forNode);
    return () => {
        scopes.vFor--;
        if ( context.prefixIdentifiers) {
            value && removeIdentifiers(value);
            key && removeIdentifiers(key);
            index && removeIdentifiers(index);
        }
        if (onExit)
            onExit();
    };
}
const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/;
// This regex doesn't cover the case if key or index aliases have destructuring,
// but those do not make sense in the first place, so this works in practice.
const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/;
const stripParensRE = /^\(|\)$/g;
function parseForExpression(input, context) {
    const loc = input.loc;
    const exp = input.content;
    const inMatch = exp.match(forAliasRE);
    if (!inMatch)
        return;
    const [, LHS, RHS] = inMatch;
    const result = {
        source: createAliasExpression(loc, RHS.trim(), exp.indexOf(RHS, LHS.length)),
        value: undefined,
        key: undefined,
        index: undefined
    };
    if ( context.prefixIdentifiers) {
        result.source = processExpression(result.source, context);
    }
    let valueContent = LHS.trim()
        .replace(stripParensRE, '')
        .trim();
    const trimmedOffset = LHS.indexOf(valueContent);
    const iteratorMatch = valueContent.match(forIteratorRE);
    if (iteratorMatch) {
        valueContent = valueContent.replace(forIteratorRE, '').trim();
        const keyContent = iteratorMatch[1].trim();
        let keyOffset;
        if (keyContent) {
            keyOffset = exp.indexOf(keyContent, trimmedOffset + valueContent.length);
            result.key = createAliasExpression(loc, keyContent, keyOffset);
            if ( context.prefixIdentifiers) {
                result.key = processExpression(result.key, context, true);
            }
        }
        if (iteratorMatch[2]) {
            const indexContent = iteratorMatch[2].trim();
            if (indexContent) {
                result.index = createAliasExpression(loc, indexContent, exp.indexOf(indexContent, result.key
                    ? keyOffset + keyContent.length
                    : trimmedOffset + valueContent.length));
                if ( context.prefixIdentifiers) {
                    result.index = processExpression(result.index, context, true);
                }
            }
        }
    }
    if (valueContent) {
        result.value = createAliasExpression(loc, valueContent, trimmedOffset);
        if ( context.prefixIdentifiers) {
            result.value = processExpression(result.value, context, true);
        }
    }
    return result;
}
function createAliasExpression(range, content, offset) {
    return createSimpleExpression(content, false, getInnerRange(range, offset, content.length));
}
function createForLoopParams({ value, key, index }) {
    const params = [];
    if (value) {
        params.push(value);
    }
    if (key) {
        if (!value) {
            params.push(createSimpleExpression(`_`, false));
        }
        params.push(key);
    }
    if (index) {
        if (!key) {
            if (!value) {
                params.push(createSimpleExpression(`_`, false));
            }
            params.push(createSimpleExpression(`__`, false));
        }
        params.push(index);
    }
    return params;
}

const defaultFallback = createSimpleExpression(`undefined`, false);
// A NodeTransform that:
// 1. Tracks scope identifiers for scoped slots so that they don't get prefixed
//    by transformExpression. This is only applied in non-browser builds with
//    { prefixIdentifiers: true }.
// 2. Track v-slot depths so that we know a slot is inside another slot.
//    Note the exit callback is executed before buildSlots() on the same node,
//    so only nested slots see positive numbers.
const trackSlotScopes = (node, context) => {
    if (node.type === 1 /* ELEMENT */ &&
        (node.tagType === 1 /* COMPONENT */ ||
            node.tagType === 3 /* TEMPLATE */)) {
        // We are only checking non-empty v-slot here
        // since we only care about slots that introduce scope variables.
        const vSlot = findDir(node, 'slot');
        if (vSlot) {
            const slotProps = vSlot.exp;
            if ( context.prefixIdentifiers) {
                slotProps && context.addIdentifiers(slotProps);
            }
            context.scopes.vSlot++;
            return () => {
                if ( context.prefixIdentifiers) {
                    slotProps && context.removeIdentifiers(slotProps);
                }
                context.scopes.vSlot--;
            };
        }
    }
};
// A NodeTransform that tracks scope identifiers for scoped slots with v-for.
// This transform is only applied in non-browser builds with { prefixIdentifiers: true }
const trackVForSlotScopes = (node, context) => {
    let vFor;
    if (isTemplateNode(node) &&
        node.props.some(isVSlot) &&
        (vFor = findDir(node, 'for'))) {
        const result = (vFor.parseResult = parseForExpression(vFor.exp, context));
        if (result) {
            const { value, key, index } = result;
            const { addIdentifiers, removeIdentifiers } = context;
            value && addIdentifiers(value);
            key && addIdentifiers(key);
            index && addIdentifiers(index);
            return () => {
                value && removeIdentifiers(value);
                key && removeIdentifiers(key);
                index && removeIdentifiers(index);
            };
        }
    }
};
const buildClientSlotFn = (props, children, loc) => createFunctionExpression(props, children, false /* newline */, true /* isSlot */, children.length ? children[0].loc : loc);
// Instead of being a DirectiveTransform, v-slot processing is called during
// transformElement to build the slots object for a component.
function buildSlots(node, context, buildSlotFn = buildClientSlotFn) {
    context.helper(WITH_CTX);
    const { children, loc } = node;
    const slotsProperties = [];
    const dynamicSlots = [];
    const buildDefaultSlotProperty = (props, children) => createObjectProperty(`default`, buildSlotFn(props, children, loc));
    // If the slot is inside a v-for or another v-slot, force it to be dynamic
    // since it likely uses a scope variable.
    let hasDynamicSlots = context.scopes.vSlot > 0 || context.scopes.vFor > 0;
    // with `prefixIdentifiers: true`, this can be further optimized to make
    // it dynamic only when the slot actually uses the scope variables.
    if ( !context.ssr && context.prefixIdentifiers) {
        hasDynamicSlots = hasScopeRef(node, context.identifiers);
    }
    // 1. Check for slot with slotProps on component itself.
    //    <Comp v-slot="{ prop }"/>
    const onComponentSlot = findDir(node, 'slot', true);
    if (onComponentSlot) {
        const { arg, exp } = onComponentSlot;
        if (arg && !isStaticExp(arg)) {
            hasDynamicSlots = true;
        }
        slotsProperties.push(createObjectProperty(arg || createSimpleExpression('default', true), buildSlotFn(exp, children, loc)));
    }
    // 2. Iterate through children and check for template slots
    //    <template v-slot:foo="{ prop }">
    let hasTemplateSlots = false;
    let hasNamedDefaultSlot = false;
    const implicitDefaultChildren = [];
    const seenSlotNames = new Set();
    for (let i = 0; i < children.length; i++) {
        const slotElement = children[i];
        let slotDir;
        if (!isTemplateNode(slotElement) ||
            !(slotDir = findDir(slotElement, 'slot', true))) {
            // not a <template v-slot>, skip.
            if (slotElement.type !== 3 /* COMMENT */) {
                implicitDefaultChildren.push(slotElement);
            }
            continue;
        }
        if (onComponentSlot) {
            // already has on-component slot - this is incorrect usage.
            context.onError(createCompilerError(36 /* X_V_SLOT_MIXED_SLOT_USAGE */, slotDir.loc));
            break;
        }
        hasTemplateSlots = true;
        const { children: slotChildren, loc: slotLoc } = slotElement;
        const { arg: slotName = createSimpleExpression(`default`, true), exp: slotProps, loc: dirLoc } = slotDir;
        // check if name is dynamic.
        let staticSlotName;
        if (isStaticExp(slotName)) {
            staticSlotName = slotName ? slotName.content : `default`;
        }
        else {
            hasDynamicSlots = true;
        }
        const slotFunction = buildSlotFn(slotProps, slotChildren, slotLoc);
        // check if this slot is conditional (v-if/v-for)
        let vIf;
        let vElse;
        let vFor;
        if ((vIf = findDir(slotElement, 'if'))) {
            hasDynamicSlots = true;
            dynamicSlots.push(createConditionalExpression(vIf.exp, buildDynamicSlot(slotName, slotFunction), defaultFallback));
        }
        else if ((vElse = findDir(slotElement, /^else(-if)?$/, true /* allowEmpty */))) {
            // find adjacent v-if
            let j = i;
            let prev;
            while (j--) {
                prev = children[j];
                if (prev.type !== 3 /* COMMENT */) {
                    break;
                }
            }
            if (prev && isTemplateNode(prev) && findDir(prev, 'if')) {
                // remove node
                children.splice(i, 1);
                i--;
                // attach this slot to previous conditional
                let conditional = dynamicSlots[dynamicSlots.length - 1];
                while (conditional.alternate.type === 19 /* JS_CONDITIONAL_EXPRESSION */) {
                    conditional = conditional.alternate;
                }
                conditional.alternate = vElse.exp
                    ? createConditionalExpression(vElse.exp, buildDynamicSlot(slotName, slotFunction), defaultFallback)
                    : buildDynamicSlot(slotName, slotFunction);
            }
            else {
                context.onError(createCompilerError(29 /* X_V_ELSE_NO_ADJACENT_IF */, vElse.loc));
            }
        }
        else if ((vFor = findDir(slotElement, 'for'))) {
            hasDynamicSlots = true;
            const parseResult = vFor.parseResult ||
                parseForExpression(vFor.exp, context);
            if (parseResult) {
                // Render the dynamic slots as an array and add it to the createSlot()
                // args. The runtime knows how to handle it appropriately.
                dynamicSlots.push(createCallExpression(context.helper(RENDER_LIST), [
                    parseResult.source,
                    createFunctionExpression(createForLoopParams(parseResult), buildDynamicSlot(slotName, slotFunction), true /* force newline */)
                ]));
            }
            else {
                context.onError(createCompilerError(31 /* X_V_FOR_MALFORMED_EXPRESSION */, vFor.loc));
            }
        }
        else {
            // check duplicate static names
            if (staticSlotName) {
                if (seenSlotNames.has(staticSlotName)) {
                    context.onError(createCompilerError(37 /* X_V_SLOT_DUPLICATE_SLOT_NAMES */, dirLoc));
                    continue;
                }
                seenSlotNames.add(staticSlotName);
                if (staticSlotName === 'default') {
                    hasNamedDefaultSlot = true;
                }
            }
            slotsProperties.push(createObjectProperty(slotName, slotFunction));
        }
    }
    if (!onComponentSlot) {
        if (!hasTemplateSlots) {
            // implicit default slot (on component)
            slotsProperties.push(buildDefaultSlotProperty(undefined, children));
        }
        else if (implicitDefaultChildren.length) {
            // implicit default slot (mixed with named slots)
            if (hasNamedDefaultSlot) {
                context.onError(createCompilerError(38 /* X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN */, implicitDefaultChildren[0].loc));
            }
            else {
                slotsProperties.push(buildDefaultSlotProperty(undefined, implicitDefaultChildren));
            }
        }
    }
    const slotFlag = hasDynamicSlots
        ? 2 /* DYNAMIC */
        : hasForwardedSlots(node.children)
            ? 3 /* FORWARDED */
            : 1 /* STABLE */;
    let slots = createObjectExpression(slotsProperties.concat(createObjectProperty(`_`, 
    // 2 = compiled but dynamic = can skip normalization, but must run diff
    // 1 = compiled and static = can skip normalization AND diff as optimized
    createSimpleExpression(slotFlag + ( ` /* ${slotFlagsText[slotFlag]} */` ), false))), loc);
    if (dynamicSlots.length) {
        slots = createCallExpression(context.helper(CREATE_SLOTS), [
            slots,
            createArrayExpression(dynamicSlots)
        ]);
    }
    return {
        slots,
        hasDynamicSlots
    };
}
function buildDynamicSlot(name, fn) {
    return createObjectExpression([
        createObjectProperty(`name`, name),
        createObjectProperty(`fn`, fn)
    ]);
}
function hasForwardedSlots(children) {
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === 1 /* ELEMENT */) {
            if (child.tagType === 2 /* SLOT */ ||
                (child.tagType === 0 /* ELEMENT */ &&
                    hasForwardedSlots(child.children))) {
                return true;
            }
        }
    }
    return false;
}

// some directive transforms (e.g. v-model) may return a symbol for runtime
// import, which should be used instead of a resolveDirective call.
const directiveImportMap = new WeakMap();
// generate a JavaScript AST for this element's codegen
const transformElement = (node, context) => {
    if (!(node.type === 1 /* ELEMENT */ &&
        (node.tagType === 0 /* ELEMENT */ ||
            node.tagType === 1 /* COMPONENT */))) {
        return;
    }
    // perform the work on exit, after all child expressions have been
    // processed and merged.
    return function postTransformElement() {
        const { tag, props } = node;
        const isComponent = node.tagType === 1 /* COMPONENT */;
        // The goal of the transform is to create a codegenNode implementing the
        // VNodeCall interface.
        const vnodeTag = isComponent
            ? resolveComponentType(node, context)
            : `"${tag}"`;
        const isDynamicComponent = isObject(vnodeTag) && vnodeTag.callee === RESOLVE_DYNAMIC_COMPONENT;
        let vnodeProps;
        let vnodeChildren;
        let vnodePatchFlag;
        let patchFlag = 0;
        let vnodeDynamicProps;
        let dynamicPropNames;
        let vnodeDirectives;
        let shouldUseBlock = 
        // dynamic component may resolve to plain elements
        isDynamicComponent ||
            vnodeTag === TELEPORT ||
            vnodeTag === SUSPENSE ||
            (!isComponent &&
                // <svg> and <foreignObject> must be forced into blocks so that block
                // updates inside get proper isSVG flag at runtime. (#639, #643)
                // This is technically web-specific, but splitting the logic out of core
                // leads to too much unnecessary complexity.
                (tag === 'svg' ||
                    tag === 'foreignObject' ||
                    // #938: elements with dynamic keys should be forced into blocks
                    findProp(node, 'key', true)));
        // props
        if (props.length > 0) {
            const propsBuildResult = buildProps(node, context);
            vnodeProps = propsBuildResult.props;
            patchFlag = propsBuildResult.patchFlag;
            dynamicPropNames = propsBuildResult.dynamicPropNames;
            const directives = propsBuildResult.directives;
            vnodeDirectives =
                directives && directives.length
                    ? createArrayExpression(directives.map(dir => buildDirectiveArgs(dir, context)))
                    : undefined;
        }
        // children
        if (node.children.length > 0) {
            if (vnodeTag === KEEP_ALIVE) {
                // Although a built-in component, we compile KeepAlive with raw children
                // instead of slot functions so that it can be used inside Transition
                // or other Transition-wrapping HOCs.
                // To ensure correct updates with block optimizations, we need to:
                // 1. Force keep-alive into a block. This avoids its children being
                //    collected by a parent block.
                shouldUseBlock = true;
                // 2. Force keep-alive to always be updated, since it uses raw children.
                patchFlag |= 1024 /* DYNAMIC_SLOTS */;
                if ( node.children.length > 1) {
                    context.onError(createCompilerError(44 /* X_KEEP_ALIVE_INVALID_CHILDREN */, {
                        start: node.children[0].loc.start,
                        end: node.children[node.children.length - 1].loc.end,
                        source: ''
                    }));
                }
            }
            const shouldBuildAsSlots = isComponent &&
                // Teleport is not a real component and has dedicated runtime handling
                vnodeTag !== TELEPORT &&
                // explained above.
                vnodeTag !== KEEP_ALIVE;
            if (shouldBuildAsSlots) {
                const { slots, hasDynamicSlots } = buildSlots(node, context);
                vnodeChildren = slots;
                if (hasDynamicSlots) {
                    patchFlag |= 1024 /* DYNAMIC_SLOTS */;
                }
            }
            else if (node.children.length === 1 && vnodeTag !== TELEPORT) {
                const child = node.children[0];
                const type = child.type;
                // check for dynamic text children
                const hasDynamicTextChild = type === 5 /* INTERPOLATION */ ||
                    type === 8 /* COMPOUND_EXPRESSION */;
                if (hasDynamicTextChild &&
                    getConstantType(child, context) === 0 /* NOT_CONSTANT */) {
                    patchFlag |= 1 /* TEXT */;
                }
                // pass directly if the only child is a text node
                // (plain / interpolation / expression)
                if (hasDynamicTextChild || type === 2 /* TEXT */) {
                    vnodeChildren = child;
                }
                else {
                    vnodeChildren = node.children;
                }
            }
            else {
                vnodeChildren = node.children;
            }
        }
        // patchFlag & dynamicPropNames
        if (patchFlag !== 0) {
            {
                if (patchFlag < 0) {
                    // special flags (negative and mutually exclusive)
                    vnodePatchFlag = patchFlag + ` /* ${PatchFlagNames[patchFlag]} */`;
                }
                else {
                    // bitwise flags
                    const flagNames = Object.keys(PatchFlagNames)
                        .map(Number)
                        .filter(n => n > 0 && patchFlag & n)
                        .map(n => PatchFlagNames[n])
                        .join(`, `);
                    vnodePatchFlag = patchFlag + ` /* ${flagNames} */`;
                }
            }
            if (dynamicPropNames && dynamicPropNames.length) {
                vnodeDynamicProps = stringifyDynamicPropNames(dynamicPropNames);
            }
        }
        node.codegenNode = createVNodeCall(context, vnodeTag, vnodeProps, vnodeChildren, vnodePatchFlag, vnodeDynamicProps, vnodeDirectives, !!shouldUseBlock, false /* disableTracking */, node.loc);
    };
};
function resolveComponentType(node, context, ssr = false) {
    const { tag } = node;
    // 1. dynamic component
    const isProp = node.tag === 'component' ? findProp(node, 'is') : findDir(node, 'is');
    if (isProp) {
        const exp = isProp.type === 6 /* ATTRIBUTE */
            ? isProp.value && createSimpleExpression(isProp.value.content, true)
            : isProp.exp;
        if (exp) {
            return createCallExpression(context.helper(RESOLVE_DYNAMIC_COMPONENT), [
                exp
            ]);
        }
    }
    // 2. built-in components (Teleport, Transition, KeepAlive, Suspense...)
    const builtIn = isCoreComponent(tag) || context.isBuiltInComponent(tag);
    if (builtIn) {
        // built-ins are simply fallthroughs / have special handling during ssr
        // so we don't need to import their runtime equivalents
        if (!ssr)
            context.helper(builtIn);
        return builtIn;
    }
    // 3. user component (from setup bindings)
    // this is skipped in browser build since browser builds do not perform
    // binding analysis.
    {
        const fromSetup = resolveSetupReference(tag, context);
        if (fromSetup) {
            return fromSetup;
        }
    }
    // 4. Self referencing component (inferred from filename)
    if ( context.selfName) {
        if (capitalize(camelize(tag)) === context.selfName) {
            context.helper(RESOLVE_COMPONENT);
            context.components.add(`_self`);
            return toValidAssetId(`_self`, `component`);
        }
    }
    // 5. user component (resolve)
    context.helper(RESOLVE_COMPONENT);
    context.components.add(tag);
    return toValidAssetId(tag, `component`);
}
function resolveSetupReference(name, context) {
    const bindings = context.bindingMetadata;
    if (!bindings) {
        return;
    }
    const camelName = camelize(name);
    const PascalName = capitalize(camelName);
    const checkType = (type) => {
        if (bindings[name] === type) {
            return name;
        }
        if (bindings[camelName] === type) {
            return camelName;
        }
        if (bindings[PascalName] === type) {
            return PascalName;
        }
    };
    const fromConst = checkType("setup-const" /* SETUP_CONST */);
    if (fromConst) {
        return context.inline
            ? // in inline mode, const setup bindings (e.g. imports) can be used as-is
                fromConst
            : `$setup[${JSON.stringify(fromConst)}]`;
    }
    const fromMaybeRef = checkType("setup-let" /* SETUP_LET */) ||
        checkType("setup-ref" /* SETUP_REF */) ||
        checkType("setup-maybe-ref" /* SETUP_MAYBE_REF */);
    if (fromMaybeRef) {
        return context.inline
            ? // setup scope bindings that may be refs need to be unrefed
                `${context.helperString(UNREF)}(${fromMaybeRef})`
            : `$setup[${JSON.stringify(fromMaybeRef)}]`;
    }
}
function buildProps(node, context, props = node.props, ssr = false) {
    const { tag, loc: elementLoc } = node;
    const isComponent = node.tagType === 1 /* COMPONENT */;
    let properties = [];
    const mergeArgs = [];
    const runtimeDirectives = [];
    // patchFlag analysis
    let patchFlag = 0;
    let hasRef = false;
    let hasClassBinding = false;
    let hasStyleBinding = false;
    let hasHydrationEventBinding = false;
    let hasDynamicKeys = false;
    let hasVnodeHook = false;
    const dynamicPropNames = [];
    const analyzePatchFlag = ({ key, value }) => {
        if (isStaticExp(key)) {
            const name = key.content;
            const isEventHandler = isOn(name);
            if (!isComponent &&
                isEventHandler &&
                // omit the flag for click handlers because hydration gives click
                // dedicated fast path.
                name.toLowerCase() !== 'onclick' &&
                // omit v-model handlers
                name !== 'onUpdate:modelValue' &&
                // omit onVnodeXXX hooks
                !isReservedProp(name)) {
                hasHydrationEventBinding = true;
            }
            if (isEventHandler && isReservedProp(name)) {
                hasVnodeHook = true;
            }
            if (value.type === 20 /* JS_CACHE_EXPRESSION */ ||
                ((value.type === 4 /* SIMPLE_EXPRESSION */ ||
                    value.type === 8 /* COMPOUND_EXPRESSION */) &&
                    getConstantType(value, context) > 0)) {
                // skip if the prop is a cached handler or has constant value
                return;
            }
            if (name === 'ref') {
                hasRef = true;
            }
            else if (name === 'class' && !isComponent) {
                hasClassBinding = true;
            }
            else if (name === 'style' && !isComponent) {
                hasStyleBinding = true;
            }
            else if (name !== 'key' && !dynamicPropNames.includes(name)) {
                dynamicPropNames.push(name);
            }
        }
        else {
            hasDynamicKeys = true;
        }
    };
    for (let i = 0; i < props.length; i++) {
        // static attribute
        const prop = props[i];
        if (prop.type === 6 /* ATTRIBUTE */) {
            const { loc, name, value } = prop;
            let isStatic = true;
            if (name === 'ref') {
                hasRef = true;
                // in inline mode there is no setupState object, so we can't use string
                // keys to set the ref. Instead, we need to transform it to pass the
                // acrtual ref instead.
                if ( context.inline) {
                    isStatic = false;
                }
            }
            // skip :is on <component>
            if (name === 'is' && tag === 'component') {
                continue;
            }
            properties.push(createObjectProperty(createSimpleExpression(name, true, getInnerRange(loc, 0, name.length)), createSimpleExpression(value ? value.content : '', isStatic, value ? value.loc : loc)));
        }
        else {
            // directives
            const { name, arg, exp, loc } = prop;
            const isBind = name === 'bind';
            const isOn = name === 'on';
            // skip v-slot - it is handled by its dedicated transform.
            if (name === 'slot') {
                if (!isComponent) {
                    context.onError(createCompilerError(39 /* X_V_SLOT_MISPLACED */, loc));
                }
                continue;
            }
            // skip v-once - it is handled by its dedicated transform.
            if (name === 'once') {
                continue;
            }
            // skip v-is and :is on <component>
            if (name === 'is' ||
                (isBind && tag === 'component' && isBindKey(arg, 'is'))) {
                continue;
            }
            // skip v-on in SSR compilation
            if (isOn && ssr) {
                continue;
            }
            // special case for v-bind and v-on with no argument
            if (!arg && (isBind || isOn)) {
                hasDynamicKeys = true;
                if (exp) {
                    if (properties.length) {
                        mergeArgs.push(createObjectExpression(dedupeProperties(properties), elementLoc));
                        properties = [];
                    }
                    if (isBind) {
                        mergeArgs.push(exp);
                    }
                    else {
                        // v-on="obj" -> toHandlers(obj)
                        mergeArgs.push({
                            type: 14 /* JS_CALL_EXPRESSION */,
                            loc,
                            callee: context.helper(TO_HANDLERS),
                            arguments: [exp]
                        });
                    }
                }
                else {
                    context.onError(createCompilerError(isBind
                        ? 33 /* X_V_BIND_NO_EXPRESSION */
                        : 34 /* X_V_ON_NO_EXPRESSION */, loc));
                }
                continue;
            }
            const directiveTransform = context.directiveTransforms[name];
            if (directiveTransform) {
                // has built-in directive transform.
                const { props, needRuntime } = directiveTransform(prop, node, context);
                !ssr && props.forEach(analyzePatchFlag);
                properties.push(...props);
                if (needRuntime) {
                    runtimeDirectives.push(prop);
                    if (isSymbol(needRuntime)) {
                        directiveImportMap.set(prop, needRuntime);
                    }
                }
            }
            else {
                // no built-in transform, this is a user custom directive.
                runtimeDirectives.push(prop);
            }
        }
    }
    let propsExpression = undefined;
    // has v-bind="object" or v-on="object", wrap with mergeProps
    if (mergeArgs.length) {
        if (properties.length) {
            mergeArgs.push(createObjectExpression(dedupeProperties(properties), elementLoc));
        }
        if (mergeArgs.length > 1) {
            propsExpression = createCallExpression(context.helper(MERGE_PROPS), mergeArgs, elementLoc);
        }
        else {
            // single v-bind with nothing else - no need for a mergeProps call
            propsExpression = mergeArgs[0];
        }
    }
    else if (properties.length) {
        propsExpression = createObjectExpression(dedupeProperties(properties), elementLoc);
    }
    // patchFlag analysis
    if (hasDynamicKeys) {
        patchFlag |= 16 /* FULL_PROPS */;
    }
    else {
        if (hasClassBinding) {
            patchFlag |= 2 /* CLASS */;
        }
        if (hasStyleBinding) {
            patchFlag |= 4 /* STYLE */;
        }
        if (dynamicPropNames.length) {
            patchFlag |= 8 /* PROPS */;
        }
        if (hasHydrationEventBinding) {
            patchFlag |= 32 /* HYDRATE_EVENTS */;
        }
    }
    if ((patchFlag === 0 || patchFlag === 32 /* HYDRATE_EVENTS */) &&
        (hasRef || hasVnodeHook || runtimeDirectives.length > 0)) {
        patchFlag |= 512 /* NEED_PATCH */;
    }
    return {
        props: propsExpression,
        directives: runtimeDirectives,
        patchFlag,
        dynamicPropNames
    };
}
// Dedupe props in an object literal.
// Literal duplicated attributes would have been warned during the parse phase,
// however, it's possible to encounter duplicated `onXXX` handlers with different
// modifiers. We also need to merge static and dynamic class / style attributes.
// - onXXX handlers / style: merge into array
// - class: merge into single expression with concatenation
function dedupeProperties(properties) {
    const knownProps = new Map();
    const deduped = [];
    for (let i = 0; i < properties.length; i++) {
        const prop = properties[i];
        // dynamic keys are always allowed
        if (prop.key.type === 8 /* COMPOUND_EXPRESSION */ || !prop.key.isStatic) {
            deduped.push(prop);
            continue;
        }
        const name = prop.key.content;
        const existing = knownProps.get(name);
        if (existing) {
            if (name === 'style' || name === 'class' || name.startsWith('on')) {
                mergeAsArray(existing, prop);
            }
            // unexpected duplicate, should have emitted error during parse
        }
        else {
            knownProps.set(name, prop);
            deduped.push(prop);
        }
    }
    return deduped;
}
function mergeAsArray(existing, incoming) {
    if (existing.value.type === 17 /* JS_ARRAY_EXPRESSION */) {
        existing.value.elements.push(incoming.value);
    }
    else {
        existing.value = createArrayExpression([existing.value, incoming.value], existing.loc);
    }
}
function buildDirectiveArgs(dir, context) {
    const dirArgs = [];
    const runtime = directiveImportMap.get(dir);
    if (runtime) {
        // built-in directive with runtime
        dirArgs.push(context.helperString(runtime));
    }
    else {
        // user directive.
        // see if we have directives exposed via <script setup>
        const fromSetup =  resolveSetupReference(dir.name, context);
        if (fromSetup) {
            dirArgs.push(fromSetup);
        }
        else {
            // inject statement for resolving directive
            context.helper(RESOLVE_DIRECTIVE);
            context.directives.add(dir.name);
            dirArgs.push(toValidAssetId(dir.name, `directive`));
        }
    }
    const { loc } = dir;
    if (dir.exp)
        dirArgs.push(dir.exp);
    if (dir.arg) {
        if (!dir.exp) {
            dirArgs.push(`void 0`);
        }
        dirArgs.push(dir.arg);
    }
    if (Object.keys(dir.modifiers).length) {
        if (!dir.arg) {
            if (!dir.exp) {
                dirArgs.push(`void 0`);
            }
            dirArgs.push(`void 0`);
        }
        const trueExpression = createSimpleExpression(`true`, false, loc);
        dirArgs.push(createObjectExpression(dir.modifiers.map(modifier => createObjectProperty(modifier, trueExpression)), loc));
    }
    return createArrayExpression(dirArgs, dir.loc);
}
function stringifyDynamicPropNames(props) {
    let propsNamesString = `[`;
    for (let i = 0, l = props.length; i < l; i++) {
        propsNamesString += JSON.stringify(props[i]);
        if (i < l - 1)
            propsNamesString += ', ';
    }
    return propsNamesString + `]`;
}

const transformSlotOutlet = (node, context) => {
    if (isSlotOutlet(node)) {
        const { children, loc } = node;
        const { slotName, slotProps } = processSlotOutlet(node, context);
        const slotArgs = [
            context.prefixIdentifiers ? `_ctx.$slots` : `$slots`,
            slotName
        ];
        if (slotProps) {
            slotArgs.push(slotProps);
        }
        if (children.length) {
            if (!slotProps) {
                slotArgs.push(`{}`);
            }
            slotArgs.push(createFunctionExpression([], children, false, false, loc));
        }
        node.codegenNode = createCallExpression(context.helper(RENDER_SLOT), slotArgs, loc);
    }
};
function processSlotOutlet(node, context) {
    let slotName = `"default"`;
    let slotProps = undefined;
    const nonNameProps = [];
    for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i];
        if (p.type === 6 /* ATTRIBUTE */) {
            if (p.value) {
                if (p.name === 'name') {
                    slotName = JSON.stringify(p.value.content);
                }
                else {
                    p.name = camelize(p.name);
                    nonNameProps.push(p);
                }
            }
        }
        else {
            if (p.name === 'bind' && isBindKey(p.arg, 'name')) {
                if (p.exp)
                    slotName = p.exp;
            }
            else {
                if (p.name === 'bind' && p.arg && isStaticExp(p.arg)) {
                    p.arg.content = camelize(p.arg.content);
                }
                nonNameProps.push(p);
            }
        }
    }
    if (nonNameProps.length > 0) {
        const { props, directives } = buildProps(node, context, nonNameProps);
        slotProps = props;
        if (directives.length) {
            context.onError(createCompilerError(35 /* X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET */, directives[0].loc));
        }
    }
    return {
        slotName,
        slotProps
    };
}

const fnExpRE = /^\s*([\w$_]+|\([^)]*?\))\s*=>|^\s*function(?:\s+[\w$]+)?\s*\(/;
const transformOn = (dir, node, context, augmentor) => {
    const { loc, modifiers, arg } = dir;
    if (!dir.exp && !modifiers.length) {
        context.onError(createCompilerError(34 /* X_V_ON_NO_EXPRESSION */, loc));
    }
    let eventName;
    if (arg.type === 4 /* SIMPLE_EXPRESSION */) {
        if (arg.isStatic) {
            const rawName = arg.content;
            // for all event listeners, auto convert it to camelCase. See issue #2249
            eventName = createSimpleExpression(toHandlerKey(camelize(rawName)), true, arg.loc);
        }
        else {
            // #2388
            eventName = createCompoundExpression([
                `${context.helperString(TO_HANDLER_KEY)}(`,
                arg,
                `)`
            ]);
        }
    }
    else {
        // already a compound expression.
        eventName = arg;
        eventName.children.unshift(`${context.helperString(TO_HANDLER_KEY)}(`);
        eventName.children.push(`)`);
    }
    // handler processing
    let exp = dir.exp;
    if (exp && !exp.content.trim()) {
        exp = undefined;
    }
    let shouldCache = context.cacheHandlers && !exp;
    if (exp) {
        const isMemberExp = isMemberExpression(exp.content);
        const isInlineStatement = !(isMemberExp || fnExpRE.test(exp.content));
        const hasMultipleStatements = exp.content.includes(`;`);
        // process the expression since it's been skipped
        if ( context.prefixIdentifiers) {
            isInlineStatement && context.addIdentifiers(`$event`);
            exp = dir.exp = processExpression(exp, context, false, hasMultipleStatements);
            isInlineStatement && context.removeIdentifiers(`$event`);
            // with scope analysis, the function is hoistable if it has no reference
            // to scope variables.
            shouldCache =
                context.cacheHandlers &&
                    // runtime constants don't need to be cached
                    // (this is analyzed by compileScript in SFC <script setup>)
                    !(exp.type === 4 /* SIMPLE_EXPRESSION */ && exp.constType > 0) &&
                    // #1541 bail if this is a member exp handler passed to a component -
                    // we need to use the original function to preserve arity,
                    // e.g. <transition> relies on checking cb.length to determine
                    // transition end handling. Inline function is ok since its arity
                    // is preserved even when cached.
                    !(isMemberExp && node.tagType === 1 /* COMPONENT */) &&
                    // bail if the function references closure variables (v-for, v-slot)
                    // it must be passed fresh to avoid stale values.
                    !hasScopeRef(exp, context.identifiers);
            // If the expression is optimizable and is a member expression pointing
            // to a function, turn it into invocation (and wrap in an arrow function
            // below) so that it always accesses the latest value when called - thus
            // avoiding the need to be patched.
            if (shouldCache && isMemberExp) {
                if (exp.type === 4 /* SIMPLE_EXPRESSION */) {
                    exp.content = `${exp.content} && ${exp.content}(...args)`;
                }
                else {
                    exp.children = [...exp.children, ` && `, ...exp.children, `(...args)`];
                }
            }
        }
        if (isInlineStatement || (shouldCache && isMemberExp)) {
            // wrap inline statement in a function expression
            exp = createCompoundExpression([
                `${isInlineStatement
                    ?  context.isTS
                        ? `($event: any)`
                        : `$event`
                    : `${ context.isTS ? `\n//@ts-ignore\n` : ``}(...args)`} => ${hasMultipleStatements ? `{` : `(`}`,
                exp,
                hasMultipleStatements ? `}` : `)`
            ]);
        }
    }
    let ret = {
        props: [
            createObjectProperty(eventName, exp || createSimpleExpression(`() => {}`, false, loc))
        ]
    };
    // apply extended compiler augmentor
    if (augmentor) {
        ret = augmentor(ret);
    }
    if (shouldCache) {
        // cache handlers so that it's always the same handler being passed down.
        // this avoids unnecessary re-renders when users use inline handlers on
        // components.
        ret.props[0].value = context.cache(ret.props[0].value);
    }
    return ret;
};

// v-bind without arg is handled directly in ./transformElements.ts due to it affecting
// codegen for the entire props object. This transform here is only for v-bind
// *with* args.
const transformBind = (dir, node, context) => {
    const { exp, modifiers, loc } = dir;
    const arg = dir.arg;
    if (arg.type !== 4 /* SIMPLE_EXPRESSION */) {
        arg.children.unshift(`(`);
        arg.children.push(`) || ""`);
    }
    else if (!arg.isStatic) {
        arg.content = `${arg.content} || ""`;
    }
    // .prop is no longer necessary due to new patch behavior
    // .sync is replaced by v-model:arg
    if (modifiers.includes('camel')) {
        if (arg.type === 4 /* SIMPLE_EXPRESSION */) {
            if (arg.isStatic) {
                arg.content = camelize(arg.content);
            }
            else {
                arg.content = `${context.helperString(CAMELIZE)}(${arg.content})`;
            }
        }
        else {
            arg.children.unshift(`${context.helperString(CAMELIZE)}(`);
            arg.children.push(`)`);
        }
    }
    if (!exp ||
        (exp.type === 4 /* SIMPLE_EXPRESSION */ && !exp.content.trim())) {
        context.onError(createCompilerError(33 /* X_V_BIND_NO_EXPRESSION */, loc));
        return {
            props: [createObjectProperty(arg, createSimpleExpression('', true, loc))]
        };
    }
    return {
        props: [createObjectProperty(arg, exp)]
    };
};

// Merge adjacent text nodes and expressions into a single expression
// e.g. <div>abc {{ d }} {{ e }}</div> should have a single expression node as child.
const transformText = (node, context) => {
    if (node.type === 0 /* ROOT */ ||
        node.type === 1 /* ELEMENT */ ||
        node.type === 11 /* FOR */ ||
        node.type === 10 /* IF_BRANCH */) {
        // perform the transform on node exit so that all expressions have already
        // been processed.
        return () => {
            const children = node.children;
            let currentContainer = undefined;
            let hasText = false;
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (isText(child)) {
                    hasText = true;
                    for (let j = i + 1; j < children.length; j++) {
                        const next = children[j];
                        if (isText(next)) {
                            if (!currentContainer) {
                                currentContainer = children[i] = {
                                    type: 8 /* COMPOUND_EXPRESSION */,
                                    loc: child.loc,
                                    children: [child]
                                };
                            }
                            // merge adjacent text node into current
                            currentContainer.children.push(` + `, next);
                            children.splice(j, 1);
                            j--;
                        }
                        else {
                            currentContainer = undefined;
                            break;
                        }
                    }
                }
            }
            if (!hasText ||
                // if this is a plain element with a single text child, leave it
                // as-is since the runtime has dedicated fast path for this by directly
                // setting textContent of the element.
                // for component root it's always normalized anyway.
                (children.length === 1 &&
                    (node.type === 0 /* ROOT */ ||
                        (node.type === 1 /* ELEMENT */ &&
                            node.tagType === 0 /* ELEMENT */)))) {
                return;
            }
            // pre-convert text nodes into createTextVNode(text) calls to avoid
            // runtime normalization.
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (isText(child) || child.type === 8 /* COMPOUND_EXPRESSION */) {
                    const callArgs = [];
                    // createTextVNode defaults to single whitespace, so if it is a
                    // single space the code could be an empty call to save bytes.
                    if (child.type !== 2 /* TEXT */ || child.content !== ' ') {
                        callArgs.push(child);
                    }
                    // mark dynamic text with flag so it gets patched inside a block
                    if (!context.ssr &&
                        getConstantType(child, context) === 0 /* NOT_CONSTANT */) {
                        callArgs.push(1 /* TEXT */ +
                            ( ` /* ${PatchFlagNames[1 /* TEXT */]} */` ));
                    }
                    children[i] = {
                        type: 12 /* TEXT_CALL */,
                        content: child,
                        loc: child.loc,
                        codegenNode: createCallExpression(context.helper(CREATE_TEXT), callArgs)
                    };
                }
            }
        };
    }
};

const seen = new WeakSet();
const transformOnce = (node, context) => {
    if (node.type === 1 /* ELEMENT */ && findDir(node, 'once', true)) {
        if (seen.has(node)) {
            return;
        }
        seen.add(node);
        context.helper(SET_BLOCK_TRACKING);
        return () => {
            const cur = context.currentNode;
            if (cur.codegenNode) {
                cur.codegenNode = context.cache(cur.codegenNode, true /* isVNode */);
            }
        };
    }
};

const transformModel = (dir, node, context) => {
    const { exp, arg } = dir;
    if (!exp) {
        context.onError(createCompilerError(40 /* X_V_MODEL_NO_EXPRESSION */, dir.loc));
        return createTransformProps();
    }
    const rawExp = exp.loc.source;
    const expString = exp.type === 4 /* SIMPLE_EXPRESSION */ ? exp.content : rawExp;
    // im SFC <script setup> inline mode, the exp may have been transformed into
    // _unref(exp)
    const bindingType = context.bindingMetadata[rawExp];
    const maybeRef = 
        context.inline &&
        bindingType &&
        bindingType !== "setup-const" /* SETUP_CONST */;
    if (!isMemberExpression(expString) && !maybeRef) {
        context.onError(createCompilerError(41 /* X_V_MODEL_MALFORMED_EXPRESSION */, exp.loc));
        return createTransformProps();
    }
    if (
        context.prefixIdentifiers &&
        isSimpleIdentifier(expString) &&
        context.identifiers[expString]) {
        context.onError(createCompilerError(42 /* X_V_MODEL_ON_SCOPE_VARIABLE */, exp.loc));
        return createTransformProps();
    }
    const propName = arg ? arg : createSimpleExpression('modelValue', true);
    const eventName = arg
        ? isStaticExp(arg)
            ? `onUpdate:${arg.content}`
            : createCompoundExpression(['"onUpdate:" + ', arg])
        : `onUpdate:modelValue`;
    let assignmentExp;
    const eventArg = context.isTS ? `($event: any)` : `$event`;
    if (maybeRef) {
        if (bindingType === "setup-ref" /* SETUP_REF */) {
            // v-model used on known ref.
            assignmentExp = createCompoundExpression([
                `${eventArg} => (`,
                createSimpleExpression(rawExp, false, exp.loc),
                `.value = $event)`
            ]);
        }
        else {
            // v-model used on a potentially ref binding in <script setup> inline mode.
            // the assignment needs to check whether the binding is actually a ref.
            const altAssignment = bindingType === "setup-let" /* SETUP_LET */ ? `${rawExp} = $event` : `null`;
            assignmentExp = createCompoundExpression([
                `${eventArg} => (${context.helperString(IS_REF)}(${rawExp}) ? `,
                createSimpleExpression(rawExp, false, exp.loc),
                `.value = $event : ${altAssignment})`
            ]);
        }
    }
    else {
        assignmentExp = createCompoundExpression([
            `${eventArg} => (`,
            exp,
            ` = $event)`
        ]);
    }
    const props = [
        // modelValue: foo
        createObjectProperty(propName, dir.exp),
        // "onUpdate:modelValue": $event => (foo = $event)
        createObjectProperty(eventName, assignmentExp)
    ];
    // cache v-model handler if applicable (when it doesn't refer any scope vars)
    if (
        context.prefixIdentifiers &&
        context.cacheHandlers &&
        !hasScopeRef(exp, context.identifiers)) {
        props[1].value = context.cache(props[1].value);
    }
    // modelModifiers: { foo: true, "bar-baz": true }
    if (dir.modifiers.length && node.tagType === 1 /* COMPONENT */) {
        const modifiers = dir.modifiers
            .map(m => (isSimpleIdentifier(m) ? m : JSON.stringify(m)) + `: true`)
            .join(`, `);
        const modifiersKey = arg
            ? isStaticExp(arg)
                ? `${arg.content}Modifiers`
                : createCompoundExpression([arg, ' + "Modifiers"'])
            : `modelModifiers`;
        props.push(createObjectProperty(modifiersKey, createSimpleExpression(`{ ${modifiers} }`, false, dir.loc, 2 /* CAN_HOIST */)));
    }
    return createTransformProps(props);
};
function createTransformProps(props = []) {
    return { props };
}

function getBaseTransformPreset(prefixIdentifiers) {
    return [
        [
            transformOnce,
            transformIf,
            transformFor,
            ...( prefixIdentifiers
                ? [
                    // order is important
                    trackVForSlotScopes,
                    transformExpression
                ]
                :  []),
            transformSlotOutlet,
            transformElement,
            trackSlotScopes,
            transformText
        ],
        {
            on: transformOn,
            bind: transformBind,
            model: transformModel
        }
    ];
}
// we name it `baseCompile` so that higher order compilers like
// @vue/compiler-dom can export `compile` while re-exporting everything else.
function baseCompile(template, options = {}) {
    const onError = options.onError || defaultOnError;
    const isModuleMode = options.mode === 'module';
    const prefixIdentifiers =  (options.prefixIdentifiers === true || isModuleMode);
    if (!prefixIdentifiers && options.cacheHandlers) {
        onError(createCompilerError(47 /* X_CACHE_HANDLER_NOT_SUPPORTED */));
    }
    if (options.scopeId && !isModuleMode) {
        onError(createCompilerError(48 /* X_SCOPE_ID_NOT_SUPPORTED */));
    }
    const ast = isString(template) ? baseParse(template, options) : template;
    const [nodeTransforms, directiveTransforms] = getBaseTransformPreset(prefixIdentifiers);
    transform(ast, extend({}, options, {
        prefixIdentifiers,
        nodeTransforms: [
            ...nodeTransforms,
            ...(options.nodeTransforms || []) // user transforms
        ],
        directiveTransforms: extend({}, directiveTransforms, options.directiveTransforms || {} // user transforms
        )
    }));
    return generate(ast, extend({}, options, {
        prefixIdentifiers
    }));
}

const noopDirectiveTransform = () => ({ props: [] });

const V_MODEL_RADIO = Symbol( `vModelRadio` );
const V_MODEL_CHECKBOX = Symbol( `vModelCheckbox` );
const V_MODEL_TEXT = Symbol( `vModelText` );
const V_MODEL_SELECT = Symbol( `vModelSelect` );
const V_MODEL_DYNAMIC = Symbol( `vModelDynamic` );
const V_ON_WITH_MODIFIERS = Symbol( `vOnModifiersGuard` );
const V_ON_WITH_KEYS = Symbol( `vOnKeysGuard` );
const V_SHOW = Symbol( `vShow` );
const TRANSITION = Symbol( `Transition` );
const TRANSITION_GROUP = Symbol( `TransitionGroup` );
registerRuntimeHelpers({
    [V_MODEL_RADIO]: `vModelRadio`,
    [V_MODEL_CHECKBOX]: `vModelCheckbox`,
    [V_MODEL_TEXT]: `vModelText`,
    [V_MODEL_SELECT]: `vModelSelect`,
    [V_MODEL_DYNAMIC]: `vModelDynamic`,
    [V_ON_WITH_MODIFIERS]: `withModifiers`,
    [V_ON_WITH_KEYS]: `withKeys`,
    [V_SHOW]: `vShow`,
    [TRANSITION]: `Transition`,
    [TRANSITION_GROUP]: `TransitionGroup`
});

var namedCharacterReferences = {
	GT: ">",
	gt: ">",
	LT: "<",
	lt: "<",
	"ac;": "∾",
	"af;": "⁡",
	AMP: "&",
	amp: "&",
	"ap;": "≈",
	"DD;": "ⅅ",
	"dd;": "ⅆ",
	deg: "°",
	"ee;": "ⅇ",
	"eg;": "⪚",
	"el;": "⪙",
	ETH: "Ð",
	eth: "ð",
	"gE;": "≧",
	"ge;": "≥",
	"Gg;": "⋙",
	"gg;": "≫",
	"gl;": "≷",
	"GT;": ">",
	"Gt;": "≫",
	"gt;": ">",
	"ic;": "⁣",
	"ii;": "ⅈ",
	"Im;": "ℑ",
	"in;": "∈",
	"it;": "⁢",
	"lE;": "≦",
	"le;": "≤",
	"lg;": "≶",
	"Ll;": "⋘",
	"ll;": "≪",
	"LT;": "<",
	"Lt;": "≪",
	"lt;": "<",
	"mp;": "∓",
	"Mu;": "Μ",
	"mu;": "μ",
	"ne;": "≠",
	"ni;": "∋",
	not: "¬",
	"Nu;": "Ν",
	"nu;": "ν",
	"Or;": "⩔",
	"or;": "∨",
	"oS;": "Ⓢ",
	"Pi;": "Π",
	"pi;": "π",
	"pm;": "±",
	"Pr;": "⪻",
	"pr;": "≺",
	"Re;": "ℜ",
	REG: "®",
	reg: "®",
	"rx;": "℞",
	"Sc;": "⪼",
	"sc;": "≻",
	shy: "­",
	uml: "¨",
	"wp;": "℘",
	"wr;": "≀",
	"Xi;": "Ξ",
	"xi;": "ξ",
	yen: "¥",
	"acd;": "∿",
	"acE;": "∾̳",
	"Acy;": "А",
	"acy;": "а",
	"Afr;": "𝔄",
	"afr;": "𝔞",
	"AMP;": "&",
	"amp;": "&",
	"And;": "⩓",
	"and;": "∧",
	"ang;": "∠",
	"apE;": "⩰",
	"ape;": "≊",
	"ast;": "*",
	Auml: "Ä",
	auml: "ä",
	"Bcy;": "Б",
	"bcy;": "б",
	"Bfr;": "𝔅",
	"bfr;": "𝔟",
	"bne;": "=⃥",
	"bot;": "⊥",
	"Cap;": "⋒",
	"cap;": "∩",
	cent: "¢",
	"Cfr;": "ℭ",
	"cfr;": "𝔠",
	"Chi;": "Χ",
	"chi;": "χ",
	"cir;": "○",
	COPY: "©",
	copy: "©",
	"Cup;": "⋓",
	"cup;": "∪",
	"Dcy;": "Д",
	"dcy;": "д",
	"deg;": "°",
	"Del;": "∇",
	"Dfr;": "𝔇",
	"dfr;": "𝔡",
	"die;": "¨",
	"div;": "÷",
	"Dot;": "¨",
	"dot;": "˙",
	"Ecy;": "Э",
	"ecy;": "э",
	"Efr;": "𝔈",
	"efr;": "𝔢",
	"egs;": "⪖",
	"ell;": "ℓ",
	"els;": "⪕",
	"ENG;": "Ŋ",
	"eng;": "ŋ",
	"Eta;": "Η",
	"eta;": "η",
	"ETH;": "Ð",
	"eth;": "ð",
	Euml: "Ë",
	euml: "ë",
	"Fcy;": "Ф",
	"fcy;": "ф",
	"Ffr;": "𝔉",
	"ffr;": "𝔣",
	"gap;": "⪆",
	"Gcy;": "Г",
	"gcy;": "г",
	"gEl;": "⪌",
	"gel;": "⋛",
	"geq;": "≥",
	"ges;": "⩾",
	"Gfr;": "𝔊",
	"gfr;": "𝔤",
	"ggg;": "⋙",
	"gla;": "⪥",
	"glE;": "⪒",
	"glj;": "⪤",
	"gnE;": "≩",
	"gne;": "⪈",
	"Hat;": "^",
	"Hfr;": "ℌ",
	"hfr;": "𝔥",
	"Icy;": "И",
	"icy;": "и",
	"iff;": "⇔",
	"Ifr;": "ℑ",
	"ifr;": "𝔦",
	"Int;": "∬",
	"int;": "∫",
	Iuml: "Ï",
	iuml: "ï",
	"Jcy;": "Й",
	"jcy;": "й",
	"Jfr;": "𝔍",
	"jfr;": "𝔧",
	"Kcy;": "К",
	"kcy;": "к",
	"Kfr;": "𝔎",
	"kfr;": "𝔨",
	"lap;": "⪅",
	"lat;": "⪫",
	"Lcy;": "Л",
	"lcy;": "л",
	"lEg;": "⪋",
	"leg;": "⋚",
	"leq;": "≤",
	"les;": "⩽",
	"Lfr;": "𝔏",
	"lfr;": "𝔩",
	"lgE;": "⪑",
	"lnE;": "≨",
	"lne;": "⪇",
	"loz;": "◊",
	"lrm;": "‎",
	"Lsh;": "↰",
	"lsh;": "↰",
	macr: "¯",
	"Map;": "⤅",
	"map;": "↦",
	"Mcy;": "М",
	"mcy;": "м",
	"Mfr;": "𝔐",
	"mfr;": "𝔪",
	"mho;": "℧",
	"mid;": "∣",
	"nap;": "≉",
	nbsp: " ",
	"Ncy;": "Н",
	"ncy;": "н",
	"Nfr;": "𝔑",
	"nfr;": "𝔫",
	"ngE;": "≧̸",
	"nge;": "≱",
	"nGg;": "⋙̸",
	"nGt;": "≫⃒",
	"ngt;": "≯",
	"nis;": "⋼",
	"niv;": "∋",
	"nlE;": "≦̸",
	"nle;": "≰",
	"nLl;": "⋘̸",
	"nLt;": "≪⃒",
	"nlt;": "≮",
	"Not;": "⫬",
	"not;": "¬",
	"npr;": "⊀",
	"nsc;": "⊁",
	"num;": "#",
	"Ocy;": "О",
	"ocy;": "о",
	"Ofr;": "𝔒",
	"ofr;": "𝔬",
	"ogt;": "⧁",
	"ohm;": "Ω",
	"olt;": "⧀",
	"ord;": "⩝",
	ordf: "ª",
	ordm: "º",
	"orv;": "⩛",
	Ouml: "Ö",
	ouml: "ö",
	"par;": "∥",
	para: "¶",
	"Pcy;": "П",
	"pcy;": "п",
	"Pfr;": "𝔓",
	"pfr;": "𝔭",
	"Phi;": "Φ",
	"phi;": "φ",
	"piv;": "ϖ",
	"prE;": "⪳",
	"pre;": "⪯",
	"Psi;": "Ψ",
	"psi;": "ψ",
	"Qfr;": "𝔔",
	"qfr;": "𝔮",
	QUOT: "\"",
	quot: "\"",
	"Rcy;": "Р",
	"rcy;": "р",
	"REG;": "®",
	"reg;": "®",
	"Rfr;": "ℜ",
	"rfr;": "𝔯",
	"Rho;": "Ρ",
	"rho;": "ρ",
	"rlm;": "‏",
	"Rsh;": "↱",
	"rsh;": "↱",
	"scE;": "⪴",
	"sce;": "⪰",
	"Scy;": "С",
	"scy;": "с",
	sect: "§",
	"Sfr;": "𝔖",
	"sfr;": "𝔰",
	"shy;": "­",
	"sim;": "∼",
	"smt;": "⪪",
	"sol;": "/",
	"squ;": "□",
	"Sub;": "⋐",
	"sub;": "⊂",
	"Sum;": "∑",
	"sum;": "∑",
	"Sup;": "⋑",
	"sup;": "⊃",
	sup1: "¹",
	sup2: "²",
	sup3: "³",
	"Tab;": "\t",
	"Tau;": "Τ",
	"tau;": "τ",
	"Tcy;": "Т",
	"tcy;": "т",
	"Tfr;": "𝔗",
	"tfr;": "𝔱",
	"top;": "⊤",
	"Ucy;": "У",
	"ucy;": "у",
	"Ufr;": "𝔘",
	"ufr;": "𝔲",
	"uml;": "¨",
	Uuml: "Ü",
	uuml: "ü",
	"Vcy;": "В",
	"vcy;": "в",
	"Vee;": "⋁",
	"vee;": "∨",
	"Vfr;": "𝔙",
	"vfr;": "𝔳",
	"Wfr;": "𝔚",
	"wfr;": "𝔴",
	"Xfr;": "𝔛",
	"xfr;": "𝔵",
	"Ycy;": "Ы",
	"ycy;": "ы",
	"yen;": "¥",
	"Yfr;": "𝔜",
	"yfr;": "𝔶",
	yuml: "ÿ",
	"Zcy;": "З",
	"zcy;": "з",
	"Zfr;": "ℨ",
	"zfr;": "𝔷",
	"zwj;": "‍",
	Acirc: "Â",
	acirc: "â",
	acute: "´",
	AElig: "Æ",
	aelig: "æ",
	"andd;": "⩜",
	"andv;": "⩚",
	"ange;": "⦤",
	"Aopf;": "𝔸",
	"aopf;": "𝕒",
	"apid;": "≋",
	"apos;": "'",
	Aring: "Å",
	aring: "å",
	"Ascr;": "𝒜",
	"ascr;": "𝒶",
	"Auml;": "Ä",
	"auml;": "ä",
	"Barv;": "⫧",
	"bbrk;": "⎵",
	"Beta;": "Β",
	"beta;": "β",
	"beth;": "ℶ",
	"bNot;": "⫭",
	"bnot;": "⌐",
	"Bopf;": "𝔹",
	"bopf;": "𝕓",
	"boxH;": "═",
	"boxh;": "─",
	"boxV;": "║",
	"boxv;": "│",
	"Bscr;": "ℬ",
	"bscr;": "𝒷",
	"bsim;": "∽",
	"bsol;": "\\",
	"bull;": "•",
	"bump;": "≎",
	"caps;": "∩︀",
	"Cdot;": "Ċ",
	"cdot;": "ċ",
	cedil: "¸",
	"cent;": "¢",
	"CHcy;": "Ч",
	"chcy;": "ч",
	"circ;": "ˆ",
	"cirE;": "⧃",
	"cire;": "≗",
	"comp;": "∁",
	"cong;": "≅",
	"Copf;": "ℂ",
	"copf;": "𝕔",
	"COPY;": "©",
	"copy;": "©",
	"Cscr;": "𝒞",
	"cscr;": "𝒸",
	"csub;": "⫏",
	"csup;": "⫐",
	"cups;": "∪︀",
	"Darr;": "↡",
	"dArr;": "⇓",
	"darr;": "↓",
	"dash;": "‐",
	"dHar;": "⥥",
	"diam;": "⋄",
	"DJcy;": "Ђ",
	"djcy;": "ђ",
	"Dopf;": "𝔻",
	"dopf;": "𝕕",
	"Dscr;": "𝒟",
	"dscr;": "𝒹",
	"DScy;": "Ѕ",
	"dscy;": "ѕ",
	"dsol;": "⧶",
	"dtri;": "▿",
	"DZcy;": "Џ",
	"dzcy;": "џ",
	"ecir;": "≖",
	Ecirc: "Ê",
	ecirc: "ê",
	"Edot;": "Ė",
	"eDot;": "≑",
	"edot;": "ė",
	"emsp;": " ",
	"ensp;": " ",
	"Eopf;": "𝔼",
	"eopf;": "𝕖",
	"epar;": "⋕",
	"epsi;": "ε",
	"Escr;": "ℰ",
	"escr;": "ℯ",
	"Esim;": "⩳",
	"esim;": "≂",
	"Euml;": "Ë",
	"euml;": "ë",
	"euro;": "€",
	"excl;": "!",
	"flat;": "♭",
	"fnof;": "ƒ",
	"Fopf;": "𝔽",
	"fopf;": "𝕗",
	"fork;": "⋔",
	"Fscr;": "ℱ",
	"fscr;": "𝒻",
	"Gdot;": "Ġ",
	"gdot;": "ġ",
	"geqq;": "≧",
	"gesl;": "⋛︀",
	"GJcy;": "Ѓ",
	"gjcy;": "ѓ",
	"gnap;": "⪊",
	"gneq;": "⪈",
	"Gopf;": "𝔾",
	"gopf;": "𝕘",
	"Gscr;": "𝒢",
	"gscr;": "ℊ",
	"gsim;": "≳",
	"gtcc;": "⪧",
	"gvnE;": "≩︀",
	"half;": "½",
	"hArr;": "⇔",
	"harr;": "↔",
	"hbar;": "ℏ",
	"Hopf;": "ℍ",
	"hopf;": "𝕙",
	"Hscr;": "ℋ",
	"hscr;": "𝒽",
	Icirc: "Î",
	icirc: "î",
	"Idot;": "İ",
	"IEcy;": "Е",
	"iecy;": "е",
	iexcl: "¡",
	"imof;": "⊷",
	"IOcy;": "Ё",
	"iocy;": "ё",
	"Iopf;": "𝕀",
	"iopf;": "𝕚",
	"Iota;": "Ι",
	"iota;": "ι",
	"Iscr;": "ℐ",
	"iscr;": "𝒾",
	"isin;": "∈",
	"Iuml;": "Ï",
	"iuml;": "ï",
	"Jopf;": "𝕁",
	"jopf;": "𝕛",
	"Jscr;": "𝒥",
	"jscr;": "𝒿",
	"KHcy;": "Х",
	"khcy;": "х",
	"KJcy;": "Ќ",
	"kjcy;": "ќ",
	"Kopf;": "𝕂",
	"kopf;": "𝕜",
	"Kscr;": "𝒦",
	"kscr;": "𝓀",
	"Lang;": "⟪",
	"lang;": "⟨",
	laquo: "«",
	"Larr;": "↞",
	"lArr;": "⇐",
	"larr;": "←",
	"late;": "⪭",
	"lcub;": "{",
	"ldca;": "⤶",
	"ldsh;": "↲",
	"leqq;": "≦",
	"lesg;": "⋚︀",
	"lHar;": "⥢",
	"LJcy;": "Љ",
	"ljcy;": "љ",
	"lnap;": "⪉",
	"lneq;": "⪇",
	"Lopf;": "𝕃",
	"lopf;": "𝕝",
	"lozf;": "⧫",
	"lpar;": "(",
	"Lscr;": "ℒ",
	"lscr;": "𝓁",
	"lsim;": "≲",
	"lsqb;": "[",
	"ltcc;": "⪦",
	"ltri;": "◃",
	"lvnE;": "≨︀",
	"macr;": "¯",
	"male;": "♂",
	"malt;": "✠",
	micro: "µ",
	"mlcp;": "⫛",
	"mldr;": "…",
	"Mopf;": "𝕄",
	"mopf;": "𝕞",
	"Mscr;": "ℳ",
	"mscr;": "𝓂",
	"nang;": "∠⃒",
	"napE;": "⩰̸",
	"nbsp;": " ",
	"ncap;": "⩃",
	"ncup;": "⩂",
	"ngeq;": "≱",
	"nges;": "⩾̸",
	"ngtr;": "≯",
	"nGtv;": "≫̸",
	"nisd;": "⋺",
	"NJcy;": "Њ",
	"njcy;": "њ",
	"nldr;": "‥",
	"nleq;": "≰",
	"nles;": "⩽̸",
	"nLtv;": "≪̸",
	"nmid;": "∤",
	"Nopf;": "ℕ",
	"nopf;": "𝕟",
	"npar;": "∦",
	"npre;": "⪯̸",
	"nsce;": "⪰̸",
	"Nscr;": "𝒩",
	"nscr;": "𝓃",
	"nsim;": "≁",
	"nsub;": "⊄",
	"nsup;": "⊅",
	"ntgl;": "≹",
	"ntlg;": "≸",
	"nvap;": "≍⃒",
	"nvge;": "≥⃒",
	"nvgt;": ">⃒",
	"nvle;": "≤⃒",
	"nvlt;": "<⃒",
	"oast;": "⊛",
	"ocir;": "⊚",
	Ocirc: "Ô",
	ocirc: "ô",
	"odiv;": "⨸",
	"odot;": "⊙",
	"ogon;": "˛",
	"oint;": "∮",
	"omid;": "⦶",
	"Oopf;": "𝕆",
	"oopf;": "𝕠",
	"opar;": "⦷",
	"ordf;": "ª",
	"ordm;": "º",
	"oror;": "⩖",
	"Oscr;": "𝒪",
	"oscr;": "ℴ",
	"osol;": "⊘",
	"Ouml;": "Ö",
	"ouml;": "ö",
	"para;": "¶",
	"part;": "∂",
	"perp;": "⊥",
	"phiv;": "ϕ",
	"plus;": "+",
	"Popf;": "ℙ",
	"popf;": "𝕡",
	pound: "£",
	"prap;": "⪷",
	"prec;": "≺",
	"prnE;": "⪵",
	"prod;": "∏",
	"prop;": "∝",
	"Pscr;": "𝒫",
	"pscr;": "𝓅",
	"qint;": "⨌",
	"Qopf;": "ℚ",
	"qopf;": "𝕢",
	"Qscr;": "𝒬",
	"qscr;": "𝓆",
	"QUOT;": "\"",
	"quot;": "\"",
	"race;": "∽̱",
	"Rang;": "⟫",
	"rang;": "⟩",
	raquo: "»",
	"Rarr;": "↠",
	"rArr;": "⇒",
	"rarr;": "→",
	"rcub;": "}",
	"rdca;": "⤷",
	"rdsh;": "↳",
	"real;": "ℜ",
	"rect;": "▭",
	"rHar;": "⥤",
	"rhov;": "ϱ",
	"ring;": "˚",
	"Ropf;": "ℝ",
	"ropf;": "𝕣",
	"rpar;": ")",
	"Rscr;": "ℛ",
	"rscr;": "𝓇",
	"rsqb;": "]",
	"rtri;": "▹",
	"scap;": "⪸",
	"scnE;": "⪶",
	"sdot;": "⋅",
	"sect;": "§",
	"semi;": ";",
	"sext;": "✶",
	"SHcy;": "Ш",
	"shcy;": "ш",
	"sime;": "≃",
	"simg;": "⪞",
	"siml;": "⪝",
	"smid;": "∣",
	"smte;": "⪬",
	"solb;": "⧄",
	"Sopf;": "𝕊",
	"sopf;": "𝕤",
	"spar;": "∥",
	"Sqrt;": "√",
	"squf;": "▪",
	"Sscr;": "𝒮",
	"sscr;": "𝓈",
	"Star;": "⋆",
	"star;": "☆",
	"subE;": "⫅",
	"sube;": "⊆",
	"succ;": "≻",
	"sung;": "♪",
	"sup1;": "¹",
	"sup2;": "²",
	"sup3;": "³",
	"supE;": "⫆",
	"supe;": "⊇",
	szlig: "ß",
	"tbrk;": "⎴",
	"tdot;": "⃛",
	THORN: "Þ",
	thorn: "þ",
	times: "×",
	"tint;": "∭",
	"toea;": "⤨",
	"Topf;": "𝕋",
	"topf;": "𝕥",
	"tosa;": "⤩",
	"trie;": "≜",
	"Tscr;": "𝒯",
	"tscr;": "𝓉",
	"TScy;": "Ц",
	"tscy;": "ц",
	"Uarr;": "↟",
	"uArr;": "⇑",
	"uarr;": "↑",
	Ucirc: "Û",
	ucirc: "û",
	"uHar;": "⥣",
	"Uopf;": "𝕌",
	"uopf;": "𝕦",
	"Upsi;": "ϒ",
	"upsi;": "υ",
	"Uscr;": "𝒰",
	"uscr;": "𝓊",
	"utri;": "▵",
	"Uuml;": "Ü",
	"uuml;": "ü",
	"vArr;": "⇕",
	"varr;": "↕",
	"Vbar;": "⫫",
	"vBar;": "⫨",
	"Vert;": "‖",
	"vert;": "|",
	"Vopf;": "𝕍",
	"vopf;": "𝕧",
	"Vscr;": "𝒱",
	"vscr;": "𝓋",
	"Wopf;": "𝕎",
	"wopf;": "𝕨",
	"Wscr;": "𝒲",
	"wscr;": "𝓌",
	"xcap;": "⋂",
	"xcup;": "⋃",
	"xmap;": "⟼",
	"xnis;": "⋻",
	"Xopf;": "𝕏",
	"xopf;": "𝕩",
	"Xscr;": "𝒳",
	"xscr;": "𝓍",
	"xvee;": "⋁",
	"YAcy;": "Я",
	"yacy;": "я",
	"YIcy;": "Ї",
	"yicy;": "ї",
	"Yopf;": "𝕐",
	"yopf;": "𝕪",
	"Yscr;": "𝒴",
	"yscr;": "𝓎",
	"YUcy;": "Ю",
	"yucy;": "ю",
	"Yuml;": "Ÿ",
	"yuml;": "ÿ",
	"Zdot;": "Ż",
	"zdot;": "ż",
	"Zeta;": "Ζ",
	"zeta;": "ζ",
	"ZHcy;": "Ж",
	"zhcy;": "ж",
	"Zopf;": "ℤ",
	"zopf;": "𝕫",
	"Zscr;": "𝒵",
	"zscr;": "𝓏",
	"zwnj;": "‌",
	Aacute: "Á",
	aacute: "á",
	"Acirc;": "Â",
	"acirc;": "â",
	"acute;": "´",
	"AElig;": "Æ",
	"aelig;": "æ",
	Agrave: "À",
	agrave: "à",
	"aleph;": "ℵ",
	"Alpha;": "Α",
	"alpha;": "α",
	"Amacr;": "Ā",
	"amacr;": "ā",
	"amalg;": "⨿",
	"angle;": "∠",
	"angrt;": "∟",
	"angst;": "Å",
	"Aogon;": "Ą",
	"aogon;": "ą",
	"Aring;": "Å",
	"aring;": "å",
	"asymp;": "≈",
	Atilde: "Ã",
	atilde: "ã",
	"awint;": "⨑",
	"bcong;": "≌",
	"bdquo;": "„",
	"bepsi;": "϶",
	"blank;": "␣",
	"blk12;": "▒",
	"blk14;": "░",
	"blk34;": "▓",
	"block;": "█",
	"boxDL;": "╗",
	"boxDl;": "╖",
	"boxdL;": "╕",
	"boxdl;": "┐",
	"boxDR;": "╔",
	"boxDr;": "╓",
	"boxdR;": "╒",
	"boxdr;": "┌",
	"boxHD;": "╦",
	"boxHd;": "╤",
	"boxhD;": "╥",
	"boxhd;": "┬",
	"boxHU;": "╩",
	"boxHu;": "╧",
	"boxhU;": "╨",
	"boxhu;": "┴",
	"boxUL;": "╝",
	"boxUl;": "╜",
	"boxuL;": "╛",
	"boxul;": "┘",
	"boxUR;": "╚",
	"boxUr;": "╙",
	"boxuR;": "╘",
	"boxur;": "└",
	"boxVH;": "╬",
	"boxVh;": "╫",
	"boxvH;": "╪",
	"boxvh;": "┼",
	"boxVL;": "╣",
	"boxVl;": "╢",
	"boxvL;": "╡",
	"boxvl;": "┤",
	"boxVR;": "╠",
	"boxVr;": "╟",
	"boxvR;": "╞",
	"boxvr;": "├",
	"Breve;": "˘",
	"breve;": "˘",
	brvbar: "¦",
	"bsemi;": "⁏",
	"bsime;": "⋍",
	"bsolb;": "⧅",
	"bumpE;": "⪮",
	"bumpe;": "≏",
	"caret;": "⁁",
	"caron;": "ˇ",
	"ccaps;": "⩍",
	Ccedil: "Ç",
	ccedil: "ç",
	"Ccirc;": "Ĉ",
	"ccirc;": "ĉ",
	"ccups;": "⩌",
	"cedil;": "¸",
	"check;": "✓",
	"clubs;": "♣",
	"Colon;": "∷",
	"colon;": ":",
	"comma;": ",",
	"crarr;": "↵",
	"Cross;": "⨯",
	"cross;": "✗",
	"csube;": "⫑",
	"csupe;": "⫒",
	"ctdot;": "⋯",
	"cuepr;": "⋞",
	"cuesc;": "⋟",
	"cupor;": "⩅",
	curren: "¤",
	"cuvee;": "⋎",
	"cuwed;": "⋏",
	"cwint;": "∱",
	"Dashv;": "⫤",
	"dashv;": "⊣",
	"dblac;": "˝",
	"ddarr;": "⇊",
	"Delta;": "Δ",
	"delta;": "δ",
	"dharl;": "⇃",
	"dharr;": "⇂",
	"diams;": "♦",
	"disin;": "⋲",
	divide: "÷",
	"doteq;": "≐",
	"dtdot;": "⋱",
	"dtrif;": "▾",
	"duarr;": "⇵",
	"duhar;": "⥯",
	Eacute: "É",
	eacute: "é",
	"Ecirc;": "Ê",
	"ecirc;": "ê",
	"eDDot;": "⩷",
	"efDot;": "≒",
	Egrave: "È",
	egrave: "è",
	"Emacr;": "Ē",
	"emacr;": "ē",
	"empty;": "∅",
	"Eogon;": "Ę",
	"eogon;": "ę",
	"eplus;": "⩱",
	"epsiv;": "ϵ",
	"eqsim;": "≂",
	"Equal;": "⩵",
	"equiv;": "≡",
	"erarr;": "⥱",
	"erDot;": "≓",
	"esdot;": "≐",
	"exist;": "∃",
	"fflig;": "ﬀ",
	"filig;": "ﬁ",
	"fjlig;": "fj",
	"fllig;": "ﬂ",
	"fltns;": "▱",
	"forkv;": "⫙",
	frac12: "½",
	frac14: "¼",
	frac34: "¾",
	"frasl;": "⁄",
	"frown;": "⌢",
	"Gamma;": "Γ",
	"gamma;": "γ",
	"Gcirc;": "Ĝ",
	"gcirc;": "ĝ",
	"gescc;": "⪩",
	"gimel;": "ℷ",
	"gneqq;": "≩",
	"gnsim;": "⋧",
	"grave;": "`",
	"gsime;": "⪎",
	"gsiml;": "⪐",
	"gtcir;": "⩺",
	"gtdot;": "⋗",
	"Hacek;": "ˇ",
	"harrw;": "↭",
	"Hcirc;": "Ĥ",
	"hcirc;": "ĥ",
	"hoarr;": "⇿",
	Iacute: "Í",
	iacute: "í",
	"Icirc;": "Î",
	"icirc;": "î",
	"iexcl;": "¡",
	Igrave: "Ì",
	igrave: "ì",
	"iiint;": "∭",
	"iiota;": "℩",
	"IJlig;": "Ĳ",
	"ijlig;": "ĳ",
	"Imacr;": "Ī",
	"imacr;": "ī",
	"image;": "ℑ",
	"imath;": "ı",
	"imped;": "Ƶ",
	"infin;": "∞",
	"Iogon;": "Į",
	"iogon;": "į",
	"iprod;": "⨼",
	iquest: "¿",
	"isinE;": "⋹",
	"isins;": "⋴",
	"isinv;": "∈",
	"Iukcy;": "І",
	"iukcy;": "і",
	"Jcirc;": "Ĵ",
	"jcirc;": "ĵ",
	"jmath;": "ȷ",
	"Jukcy;": "Є",
	"jukcy;": "є",
	"Kappa;": "Κ",
	"kappa;": "κ",
	"lAarr;": "⇚",
	"langd;": "⦑",
	"laquo;": "«",
	"larrb;": "⇤",
	"lates;": "⪭︀",
	"lBarr;": "⤎",
	"lbarr;": "⤌",
	"lbbrk;": "❲",
	"lbrke;": "⦋",
	"lceil;": "⌈",
	"ldquo;": "“",
	"lescc;": "⪨",
	"lhard;": "↽",
	"lharu;": "↼",
	"lhblk;": "▄",
	"llarr;": "⇇",
	"lltri;": "◺",
	"lneqq;": "≨",
	"lnsim;": "⋦",
	"loang;": "⟬",
	"loarr;": "⇽",
	"lobrk;": "⟦",
	"lopar;": "⦅",
	"lrarr;": "⇆",
	"lrhar;": "⇋",
	"lrtri;": "⊿",
	"lsime;": "⪍",
	"lsimg;": "⪏",
	"lsquo;": "‘",
	"ltcir;": "⩹",
	"ltdot;": "⋖",
	"ltrie;": "⊴",
	"ltrif;": "◂",
	"mdash;": "—",
	"mDDot;": "∺",
	"micro;": "µ",
	middot: "·",
	"minus;": "−",
	"mumap;": "⊸",
	"nabla;": "∇",
	"napid;": "≋̸",
	"napos;": "ŉ",
	"natur;": "♮",
	"nbump;": "≎̸",
	"ncong;": "≇",
	"ndash;": "–",
	"neArr;": "⇗",
	"nearr;": "↗",
	"nedot;": "≐̸",
	"nesim;": "≂̸",
	"ngeqq;": "≧̸",
	"ngsim;": "≵",
	"nhArr;": "⇎",
	"nharr;": "↮",
	"nhpar;": "⫲",
	"nlArr;": "⇍",
	"nlarr;": "↚",
	"nleqq;": "≦̸",
	"nless;": "≮",
	"nlsim;": "≴",
	"nltri;": "⋪",
	"notin;": "∉",
	"notni;": "∌",
	"npart;": "∂̸",
	"nprec;": "⊀",
	"nrArr;": "⇏",
	"nrarr;": "↛",
	"nrtri;": "⋫",
	"nsime;": "≄",
	"nsmid;": "∤",
	"nspar;": "∦",
	"nsubE;": "⫅̸",
	"nsube;": "⊈",
	"nsucc;": "⊁",
	"nsupE;": "⫆̸",
	"nsupe;": "⊉",
	Ntilde: "Ñ",
	ntilde: "ñ",
	"numsp;": " ",
	"nvsim;": "∼⃒",
	"nwArr;": "⇖",
	"nwarr;": "↖",
	Oacute: "Ó",
	oacute: "ó",
	"Ocirc;": "Ô",
	"ocirc;": "ô",
	"odash;": "⊝",
	"OElig;": "Œ",
	"oelig;": "œ",
	"ofcir;": "⦿",
	Ograve: "Ò",
	ograve: "ò",
	"ohbar;": "⦵",
	"olarr;": "↺",
	"olcir;": "⦾",
	"oline;": "‾",
	"Omacr;": "Ō",
	"omacr;": "ō",
	"Omega;": "Ω",
	"omega;": "ω",
	"operp;": "⦹",
	"oplus;": "⊕",
	"orarr;": "↻",
	"order;": "ℴ",
	Oslash: "Ø",
	oslash: "ø",
	Otilde: "Õ",
	otilde: "õ",
	"ovbar;": "⌽",
	"parsl;": "⫽",
	"phone;": "☎",
	"plusb;": "⊞",
	"pluse;": "⩲",
	plusmn: "±",
	"pound;": "£",
	"prcue;": "≼",
	"Prime;": "″",
	"prime;": "′",
	"prnap;": "⪹",
	"prsim;": "≾",
	"quest;": "?",
	"rAarr;": "⇛",
	"radic;": "√",
	"rangd;": "⦒",
	"range;": "⦥",
	"raquo;": "»",
	"rarrb;": "⇥",
	"rarrc;": "⤳",
	"rarrw;": "↝",
	"ratio;": "∶",
	"RBarr;": "⤐",
	"rBarr;": "⤏",
	"rbarr;": "⤍",
	"rbbrk;": "❳",
	"rbrke;": "⦌",
	"rceil;": "⌉",
	"rdquo;": "”",
	"reals;": "ℝ",
	"rhard;": "⇁",
	"rharu;": "⇀",
	"rlarr;": "⇄",
	"rlhar;": "⇌",
	"rnmid;": "⫮",
	"roang;": "⟭",
	"roarr;": "⇾",
	"robrk;": "⟧",
	"ropar;": "⦆",
	"rrarr;": "⇉",
	"rsquo;": "’",
	"rtrie;": "⊵",
	"rtrif;": "▸",
	"sbquo;": "‚",
	"sccue;": "≽",
	"Scirc;": "Ŝ",
	"scirc;": "ŝ",
	"scnap;": "⪺",
	"scsim;": "≿",
	"sdotb;": "⊡",
	"sdote;": "⩦",
	"seArr;": "⇘",
	"searr;": "↘",
	"setmn;": "∖",
	"sharp;": "♯",
	"Sigma;": "Σ",
	"sigma;": "σ",
	"simeq;": "≃",
	"simgE;": "⪠",
	"simlE;": "⪟",
	"simne;": "≆",
	"slarr;": "←",
	"smile;": "⌣",
	"smtes;": "⪬︀",
	"sqcap;": "⊓",
	"sqcup;": "⊔",
	"sqsub;": "⊏",
	"sqsup;": "⊐",
	"srarr;": "→",
	"starf;": "★",
	"strns;": "¯",
	"subnE;": "⫋",
	"subne;": "⊊",
	"supnE;": "⫌",
	"supne;": "⊋",
	"swArr;": "⇙",
	"swarr;": "↙",
	"szlig;": "ß",
	"Theta;": "Θ",
	"theta;": "θ",
	"thkap;": "≈",
	"THORN;": "Þ",
	"thorn;": "þ",
	"Tilde;": "∼",
	"tilde;": "˜",
	"times;": "×",
	"TRADE;": "™",
	"trade;": "™",
	"trisb;": "⧍",
	"TSHcy;": "Ћ",
	"tshcy;": "ћ",
	"twixt;": "≬",
	Uacute: "Ú",
	uacute: "ú",
	"Ubrcy;": "Ў",
	"ubrcy;": "ў",
	"Ucirc;": "Û",
	"ucirc;": "û",
	"udarr;": "⇅",
	"udhar;": "⥮",
	Ugrave: "Ù",
	ugrave: "ù",
	"uharl;": "↿",
	"uharr;": "↾",
	"uhblk;": "▀",
	"ultri;": "◸",
	"Umacr;": "Ū",
	"umacr;": "ū",
	"Union;": "⋃",
	"Uogon;": "Ų",
	"uogon;": "ų",
	"uplus;": "⊎",
	"upsih;": "ϒ",
	"UpTee;": "⊥",
	"Uring;": "Ů",
	"uring;": "ů",
	"urtri;": "◹",
	"utdot;": "⋰",
	"utrif;": "▴",
	"uuarr;": "⇈",
	"varpi;": "ϖ",
	"vBarv;": "⫩",
	"VDash;": "⊫",
	"Vdash;": "⊩",
	"vDash;": "⊨",
	"vdash;": "⊢",
	"veeeq;": "≚",
	"vltri;": "⊲",
	"vnsub;": "⊂⃒",
	"vnsup;": "⊃⃒",
	"vprop;": "∝",
	"vrtri;": "⊳",
	"Wcirc;": "Ŵ",
	"wcirc;": "ŵ",
	"Wedge;": "⋀",
	"wedge;": "∧",
	"xcirc;": "◯",
	"xdtri;": "▽",
	"xhArr;": "⟺",
	"xharr;": "⟷",
	"xlArr;": "⟸",
	"xlarr;": "⟵",
	"xodot;": "⨀",
	"xrArr;": "⟹",
	"xrarr;": "⟶",
	"xutri;": "△",
	Yacute: "Ý",
	yacute: "ý",
	"Ycirc;": "Ŷ",
	"ycirc;": "ŷ",
	"Aacute;": "Á",
	"aacute;": "á",
	"Abreve;": "Ă",
	"abreve;": "ă",
	"Agrave;": "À",
	"agrave;": "à",
	"andand;": "⩕",
	"angmsd;": "∡",
	"angsph;": "∢",
	"apacir;": "⩯",
	"approx;": "≈",
	"Assign;": "≔",
	"Atilde;": "Ã",
	"atilde;": "ã",
	"barvee;": "⊽",
	"Barwed;": "⌆",
	"barwed;": "⌅",
	"becaus;": "∵",
	"bernou;": "ℬ",
	"bigcap;": "⋂",
	"bigcup;": "⋃",
	"bigvee;": "⋁",
	"bkarow;": "⤍",
	"bottom;": "⊥",
	"bowtie;": "⋈",
	"boxbox;": "⧉",
	"bprime;": "‵",
	"brvbar;": "¦",
	"bullet;": "•",
	"Bumpeq;": "≎",
	"bumpeq;": "≏",
	"Cacute;": "Ć",
	"cacute;": "ć",
	"capand;": "⩄",
	"capcap;": "⩋",
	"capcup;": "⩇",
	"capdot;": "⩀",
	"Ccaron;": "Č",
	"ccaron;": "č",
	"Ccedil;": "Ç",
	"ccedil;": "ç",
	"circeq;": "≗",
	"cirmid;": "⫯",
	"Colone;": "⩴",
	"colone;": "≔",
	"commat;": "@",
	"compfn;": "∘",
	"Conint;": "∯",
	"conint;": "∮",
	"coprod;": "∐",
	"copysr;": "℗",
	"cularr;": "↶",
	"CupCap;": "≍",
	"cupcap;": "⩆",
	"cupcup;": "⩊",
	"cupdot;": "⊍",
	"curarr;": "↷",
	"curren;": "¤",
	"cylcty;": "⌭",
	"Dagger;": "‡",
	"dagger;": "†",
	"daleth;": "ℸ",
	"Dcaron;": "Ď",
	"dcaron;": "ď",
	"dfisht;": "⥿",
	"divide;": "÷",
	"divonx;": "⋇",
	"dlcorn;": "⌞",
	"dlcrop;": "⌍",
	"dollar;": "$",
	"DotDot;": "⃜",
	"drcorn;": "⌟",
	"drcrop;": "⌌",
	"Dstrok;": "Đ",
	"dstrok;": "đ",
	"Eacute;": "É",
	"eacute;": "é",
	"easter;": "⩮",
	"Ecaron;": "Ě",
	"ecaron;": "ě",
	"ecolon;": "≕",
	"Egrave;": "È",
	"egrave;": "è",
	"egsdot;": "⪘",
	"elsdot;": "⪗",
	"emptyv;": "∅",
	"emsp13;": " ",
	"emsp14;": " ",
	"eparsl;": "⧣",
	"eqcirc;": "≖",
	"equals;": "=",
	"equest;": "≟",
	"Exists;": "∃",
	"female;": "♀",
	"ffilig;": "ﬃ",
	"ffllig;": "ﬄ",
	"ForAll;": "∀",
	"forall;": "∀",
	"frac12;": "½",
	"frac13;": "⅓",
	"frac14;": "¼",
	"frac15;": "⅕",
	"frac16;": "⅙",
	"frac18;": "⅛",
	"frac23;": "⅔",
	"frac25;": "⅖",
	"frac34;": "¾",
	"frac35;": "⅗",
	"frac38;": "⅜",
	"frac45;": "⅘",
	"frac56;": "⅚",
	"frac58;": "⅝",
	"frac78;": "⅞",
	"gacute;": "ǵ",
	"Gammad;": "Ϝ",
	"gammad;": "ϝ",
	"Gbreve;": "Ğ",
	"gbreve;": "ğ",
	"Gcedil;": "Ģ",
	"gesdot;": "⪀",
	"gesles;": "⪔",
	"gtlPar;": "⦕",
	"gtrarr;": "⥸",
	"gtrdot;": "⋗",
	"gtrsim;": "≳",
	"hairsp;": " ",
	"hamilt;": "ℋ",
	"HARDcy;": "Ъ",
	"hardcy;": "ъ",
	"hearts;": "♥",
	"hellip;": "…",
	"hercon;": "⊹",
	"homtht;": "∻",
	"horbar;": "―",
	"hslash;": "ℏ",
	"Hstrok;": "Ħ",
	"hstrok;": "ħ",
	"hybull;": "⁃",
	"hyphen;": "‐",
	"Iacute;": "Í",
	"iacute;": "í",
	"Igrave;": "Ì",
	"igrave;": "ì",
	"iiiint;": "⨌",
	"iinfin;": "⧜",
	"incare;": "℅",
	"inodot;": "ı",
	"intcal;": "⊺",
	"iquest;": "¿",
	"isinsv;": "⋳",
	"Itilde;": "Ĩ",
	"itilde;": "ĩ",
	"Jsercy;": "Ј",
	"jsercy;": "ј",
	"kappav;": "ϰ",
	"Kcedil;": "Ķ",
	"kcedil;": "ķ",
	"kgreen;": "ĸ",
	"Lacute;": "Ĺ",
	"lacute;": "ĺ",
	"lagran;": "ℒ",
	"Lambda;": "Λ",
	"lambda;": "λ",
	"langle;": "⟨",
	"larrfs;": "⤝",
	"larrhk;": "↩",
	"larrlp;": "↫",
	"larrpl;": "⤹",
	"larrtl;": "↢",
	"lAtail;": "⤛",
	"latail;": "⤙",
	"lbrace;": "{",
	"lbrack;": "[",
	"Lcaron;": "Ľ",
	"lcaron;": "ľ",
	"Lcedil;": "Ļ",
	"lcedil;": "ļ",
	"ldquor;": "„",
	"lesdot;": "⩿",
	"lesges;": "⪓",
	"lfisht;": "⥼",
	"lfloor;": "⌊",
	"lharul;": "⥪",
	"llhard;": "⥫",
	"Lmidot;": "Ŀ",
	"lmidot;": "ŀ",
	"lmoust;": "⎰",
	"loplus;": "⨭",
	"lowast;": "∗",
	"lowbar;": "_",
	"lparlt;": "⦓",
	"lrhard;": "⥭",
	"lsaquo;": "‹",
	"lsquor;": "‚",
	"Lstrok;": "Ł",
	"lstrok;": "ł",
	"lthree;": "⋋",
	"ltimes;": "⋉",
	"ltlarr;": "⥶",
	"ltrPar;": "⦖",
	"mapsto;": "↦",
	"marker;": "▮",
	"mcomma;": "⨩",
	"midast;": "*",
	"midcir;": "⫰",
	"middot;": "·",
	"minusb;": "⊟",
	"minusd;": "∸",
	"mnplus;": "∓",
	"models;": "⊧",
	"mstpos;": "∾",
	"Nacute;": "Ń",
	"nacute;": "ń",
	"nbumpe;": "≏̸",
	"Ncaron;": "Ň",
	"ncaron;": "ň",
	"Ncedil;": "Ņ",
	"ncedil;": "ņ",
	"nearhk;": "⤤",
	"nequiv;": "≢",
	"nesear;": "⤨",
	"nexist;": "∄",
	"nltrie;": "⋬",
	"notinE;": "⋹̸",
	"nparsl;": "⫽⃥",
	"nprcue;": "⋠",
	"nrarrc;": "⤳̸",
	"nrarrw;": "↝̸",
	"nrtrie;": "⋭",
	"nsccue;": "⋡",
	"nsimeq;": "≄",
	"Ntilde;": "Ñ",
	"ntilde;": "ñ",
	"numero;": "№",
	"nVDash;": "⊯",
	"nVdash;": "⊮",
	"nvDash;": "⊭",
	"nvdash;": "⊬",
	"nvHarr;": "⤄",
	"nvlArr;": "⤂",
	"nvrArr;": "⤃",
	"nwarhk;": "⤣",
	"nwnear;": "⤧",
	"Oacute;": "Ó",
	"oacute;": "ó",
	"Odblac;": "Ő",
	"odblac;": "ő",
	"odsold;": "⦼",
	"Ograve;": "Ò",
	"ograve;": "ò",
	"ominus;": "⊖",
	"origof;": "⊶",
	"Oslash;": "Ø",
	"oslash;": "ø",
	"Otilde;": "Õ",
	"otilde;": "õ",
	"Otimes;": "⨷",
	"otimes;": "⊗",
	"parsim;": "⫳",
	"percnt;": "%",
	"period;": ".",
	"permil;": "‰",
	"phmmat;": "ℳ",
	"planck;": "ℏ",
	"plankv;": "ℏ",
	"plusdo;": "∔",
	"plusdu;": "⨥",
	"plusmn;": "±",
	"preceq;": "⪯",
	"primes;": "ℙ",
	"prnsim;": "⋨",
	"propto;": "∝",
	"prurel;": "⊰",
	"puncsp;": " ",
	"qprime;": "⁗",
	"Racute;": "Ŕ",
	"racute;": "ŕ",
	"rangle;": "⟩",
	"rarrap;": "⥵",
	"rarrfs;": "⤞",
	"rarrhk;": "↪",
	"rarrlp;": "↬",
	"rarrpl;": "⥅",
	"Rarrtl;": "⤖",
	"rarrtl;": "↣",
	"rAtail;": "⤜",
	"ratail;": "⤚",
	"rbrace;": "}",
	"rbrack;": "]",
	"Rcaron;": "Ř",
	"rcaron;": "ř",
	"Rcedil;": "Ŗ",
	"rcedil;": "ŗ",
	"rdquor;": "”",
	"rfisht;": "⥽",
	"rfloor;": "⌋",
	"rharul;": "⥬",
	"rmoust;": "⎱",
	"roplus;": "⨮",
	"rpargt;": "⦔",
	"rsaquo;": "›",
	"rsquor;": "’",
	"rthree;": "⋌",
	"rtimes;": "⋊",
	"Sacute;": "Ś",
	"sacute;": "ś",
	"Scaron;": "Š",
	"scaron;": "š",
	"Scedil;": "Ş",
	"scedil;": "ş",
	"scnsim;": "⋩",
	"searhk;": "⤥",
	"seswar;": "⤩",
	"sfrown;": "⌢",
	"SHCHcy;": "Щ",
	"shchcy;": "щ",
	"sigmaf;": "ς",
	"sigmav;": "ς",
	"simdot;": "⩪",
	"smashp;": "⨳",
	"SOFTcy;": "Ь",
	"softcy;": "ь",
	"solbar;": "⌿",
	"spades;": "♠",
	"sqcaps;": "⊓︀",
	"sqcups;": "⊔︀",
	"sqsube;": "⊑",
	"sqsupe;": "⊒",
	"Square;": "□",
	"square;": "□",
	"squarf;": "▪",
	"ssetmn;": "∖",
	"ssmile;": "⌣",
	"sstarf;": "⋆",
	"subdot;": "⪽",
	"Subset;": "⋐",
	"subset;": "⊂",
	"subsim;": "⫇",
	"subsub;": "⫕",
	"subsup;": "⫓",
	"succeq;": "⪰",
	"supdot;": "⪾",
	"Supset;": "⋑",
	"supset;": "⊃",
	"supsim;": "⫈",
	"supsub;": "⫔",
	"supsup;": "⫖",
	"swarhk;": "⤦",
	"swnwar;": "⤪",
	"target;": "⌖",
	"Tcaron;": "Ť",
	"tcaron;": "ť",
	"Tcedil;": "Ţ",
	"tcedil;": "ţ",
	"telrec;": "⌕",
	"there4;": "∴",
	"thetav;": "ϑ",
	"thinsp;": " ",
	"thksim;": "∼",
	"timesb;": "⊠",
	"timesd;": "⨰",
	"topbot;": "⌶",
	"topcir;": "⫱",
	"tprime;": "‴",
	"tridot;": "◬",
	"Tstrok;": "Ŧ",
	"tstrok;": "ŧ",
	"Uacute;": "Ú",
	"uacute;": "ú",
	"Ubreve;": "Ŭ",
	"ubreve;": "ŭ",
	"Udblac;": "Ű",
	"udblac;": "ű",
	"ufisht;": "⥾",
	"Ugrave;": "Ù",
	"ugrave;": "ù",
	"ulcorn;": "⌜",
	"ulcrop;": "⌏",
	"urcorn;": "⌝",
	"urcrop;": "⌎",
	"Utilde;": "Ũ",
	"utilde;": "ũ",
	"vangrt;": "⦜",
	"varphi;": "ϕ",
	"varrho;": "ϱ",
	"Vdashl;": "⫦",
	"veebar;": "⊻",
	"vellip;": "⋮",
	"Verbar;": "‖",
	"verbar;": "|",
	"vsubnE;": "⫋︀",
	"vsubne;": "⊊︀",
	"vsupnE;": "⫌︀",
	"vsupne;": "⊋︀",
	"Vvdash;": "⊪",
	"wedbar;": "⩟",
	"wedgeq;": "≙",
	"weierp;": "℘",
	"wreath;": "≀",
	"xoplus;": "⨁",
	"xotime;": "⨂",
	"xsqcup;": "⨆",
	"xuplus;": "⨄",
	"xwedge;": "⋀",
	"Yacute;": "Ý",
	"yacute;": "ý",
	"Zacute;": "Ź",
	"zacute;": "ź",
	"Zcaron;": "Ž",
	"zcaron;": "ž",
	"zeetrf;": "ℨ",
	"alefsym;": "ℵ",
	"angrtvb;": "⊾",
	"angzarr;": "⍼",
	"asympeq;": "≍",
	"backsim;": "∽",
	"Because;": "∵",
	"because;": "∵",
	"bemptyv;": "⦰",
	"between;": "≬",
	"bigcirc;": "◯",
	"bigodot;": "⨀",
	"bigstar;": "★",
	"bnequiv;": "≡⃥",
	"boxplus;": "⊞",
	"Cayleys;": "ℭ",
	"Cconint;": "∰",
	"ccupssm;": "⩐",
	"Cedilla;": "¸",
	"cemptyv;": "⦲",
	"cirscir;": "⧂",
	"coloneq;": "≔",
	"congdot;": "⩭",
	"cudarrl;": "⤸",
	"cudarrr;": "⤵",
	"cularrp;": "⤽",
	"curarrm;": "⤼",
	"dbkarow;": "⤏",
	"ddagger;": "‡",
	"ddotseq;": "⩷",
	"demptyv;": "⦱",
	"Diamond;": "⋄",
	"diamond;": "⋄",
	"digamma;": "ϝ",
	"dotplus;": "∔",
	"DownTee;": "⊤",
	"dwangle;": "⦦",
	"Element;": "∈",
	"Epsilon;": "Ε",
	"epsilon;": "ε",
	"eqcolon;": "≕",
	"equivDD;": "⩸",
	"gesdoto;": "⪂",
	"gtquest;": "⩼",
	"gtrless;": "≷",
	"harrcir;": "⥈",
	"Implies;": "⇒",
	"intprod;": "⨼",
	"isindot;": "⋵",
	"larrbfs;": "⤟",
	"larrsim;": "⥳",
	"lbrksld;": "⦏",
	"lbrkslu;": "⦍",
	"ldrdhar;": "⥧",
	"LeftTee;": "⊣",
	"lesdoto;": "⪁",
	"lessdot;": "⋖",
	"lessgtr;": "≶",
	"lesssim;": "≲",
	"lotimes;": "⨴",
	"lozenge;": "◊",
	"ltquest;": "⩻",
	"luruhar;": "⥦",
	"maltese;": "✠",
	"minusdu;": "⨪",
	"napprox;": "≉",
	"natural;": "♮",
	"nearrow;": "↗",
	"NewLine;": "\n",
	"nexists;": "∄",
	"NoBreak;": "⁠",
	"notinva;": "∉",
	"notinvb;": "⋷",
	"notinvc;": "⋶",
	"NotLess;": "≮",
	"notniva;": "∌",
	"notnivb;": "⋾",
	"notnivc;": "⋽",
	"npolint;": "⨔",
	"npreceq;": "⪯̸",
	"nsqsube;": "⋢",
	"nsqsupe;": "⋣",
	"nsubset;": "⊂⃒",
	"nsucceq;": "⪰̸",
	"nsupset;": "⊃⃒",
	"nvinfin;": "⧞",
	"nvltrie;": "⊴⃒",
	"nvrtrie;": "⊵⃒",
	"nwarrow;": "↖",
	"olcross;": "⦻",
	"Omicron;": "Ο",
	"omicron;": "ο",
	"orderof;": "ℴ",
	"orslope;": "⩗",
	"OverBar;": "‾",
	"pertenk;": "‱",
	"planckh;": "ℎ",
	"pluscir;": "⨢",
	"plussim;": "⨦",
	"plustwo;": "⨧",
	"precsim;": "≾",
	"Product;": "∏",
	"quatint;": "⨖",
	"questeq;": "≟",
	"rarrbfs;": "⤠",
	"rarrsim;": "⥴",
	"rbrksld;": "⦎",
	"rbrkslu;": "⦐",
	"rdldhar;": "⥩",
	"realine;": "ℛ",
	"rotimes;": "⨵",
	"ruluhar;": "⥨",
	"searrow;": "↘",
	"simplus;": "⨤",
	"simrarr;": "⥲",
	"subedot;": "⫃",
	"submult;": "⫁",
	"subplus;": "⪿",
	"subrarr;": "⥹",
	"succsim;": "≿",
	"supdsub;": "⫘",
	"supedot;": "⫄",
	"suphsol;": "⟉",
	"suphsub;": "⫗",
	"suplarr;": "⥻",
	"supmult;": "⫂",
	"supplus;": "⫀",
	"swarrow;": "↙",
	"topfork;": "⫚",
	"triplus;": "⨹",
	"tritime;": "⨻",
	"UpArrow;": "↑",
	"Uparrow;": "⇑",
	"uparrow;": "↑",
	"Upsilon;": "Υ",
	"upsilon;": "υ",
	"uwangle;": "⦧",
	"vzigzag;": "⦚",
	"zigrarr;": "⇝",
	"andslope;": "⩘",
	"angmsdaa;": "⦨",
	"angmsdab;": "⦩",
	"angmsdac;": "⦪",
	"angmsdad;": "⦫",
	"angmsdae;": "⦬",
	"angmsdaf;": "⦭",
	"angmsdag;": "⦮",
	"angmsdah;": "⦯",
	"angrtvbd;": "⦝",
	"approxeq;": "≊",
	"awconint;": "∳",
	"backcong;": "≌",
	"barwedge;": "⌅",
	"bbrktbrk;": "⎶",
	"bigoplus;": "⨁",
	"bigsqcup;": "⨆",
	"biguplus;": "⨄",
	"bigwedge;": "⋀",
	"boxminus;": "⊟",
	"boxtimes;": "⊠",
	"bsolhsub;": "⟈",
	"capbrcup;": "⩉",
	"circledR;": "®",
	"circledS;": "Ⓢ",
	"cirfnint;": "⨐",
	"clubsuit;": "♣",
	"cupbrcap;": "⩈",
	"curlyvee;": "⋎",
	"cwconint;": "∲",
	"DDotrahd;": "⤑",
	"doteqdot;": "≑",
	"DotEqual;": "≐",
	"dotminus;": "∸",
	"drbkarow;": "⤐",
	"dzigrarr;": "⟿",
	"elinters;": "⏧",
	"emptyset;": "∅",
	"eqvparsl;": "⧥",
	"fpartint;": "⨍",
	"geqslant;": "⩾",
	"gesdotol;": "⪄",
	"gnapprox;": "⪊",
	"hksearow;": "⤥",
	"hkswarow;": "⤦",
	"imagline;": "ℐ",
	"imagpart;": "ℑ",
	"infintie;": "⧝",
	"integers;": "ℤ",
	"Integral;": "∫",
	"intercal;": "⊺",
	"intlarhk;": "⨗",
	"laemptyv;": "⦴",
	"ldrushar;": "⥋",
	"leqslant;": "⩽",
	"lesdotor;": "⪃",
	"LessLess;": "⪡",
	"llcorner;": "⌞",
	"lnapprox;": "⪉",
	"lrcorner;": "⌟",
	"lurdshar;": "⥊",
	"mapstoup;": "↥",
	"multimap;": "⊸",
	"naturals;": "ℕ",
	"ncongdot;": "⩭̸",
	"NotEqual;": "≠",
	"notindot;": "⋵̸",
	"NotTilde;": "≁",
	"otimesas;": "⨶",
	"parallel;": "∥",
	"PartialD;": "∂",
	"plusacir;": "⨣",
	"pointint;": "⨕",
	"Precedes;": "≺",
	"precneqq;": "⪵",
	"precnsim;": "⋨",
	"profalar;": "⌮",
	"profline;": "⌒",
	"profsurf;": "⌓",
	"raemptyv;": "⦳",
	"realpart;": "ℜ",
	"RightTee;": "⊢",
	"rppolint;": "⨒",
	"rtriltri;": "⧎",
	"scpolint;": "⨓",
	"setminus;": "∖",
	"shortmid;": "∣",
	"smeparsl;": "⧤",
	"sqsubset;": "⊏",
	"sqsupset;": "⊐",
	"subseteq;": "⊆",
	"Succeeds;": "≻",
	"succneqq;": "⪶",
	"succnsim;": "⋩",
	"SuchThat;": "∋",
	"Superset;": "⊃",
	"supseteq;": "⊇",
	"thetasym;": "ϑ",
	"thicksim;": "∼",
	"timesbar;": "⨱",
	"triangle;": "▵",
	"triminus;": "⨺",
	"trpezium;": "⏢",
	"Uarrocir;": "⥉",
	"ulcorner;": "⌜",
	"UnderBar;": "_",
	"urcorner;": "⌝",
	"varkappa;": "ϰ",
	"varsigma;": "ς",
	"vartheta;": "ϑ",
	"backprime;": "‵",
	"backsimeq;": "⋍",
	"Backslash;": "∖",
	"bigotimes;": "⨂",
	"CenterDot;": "·",
	"centerdot;": "·",
	"checkmark;": "✓",
	"CircleDot;": "⊙",
	"complexes;": "ℂ",
	"Congruent;": "≡",
	"Coproduct;": "∐",
	"dotsquare;": "⊡",
	"DoubleDot;": "¨",
	"DownArrow;": "↓",
	"Downarrow;": "⇓",
	"downarrow;": "↓",
	"DownBreve;": "̑",
	"gtrapprox;": "⪆",
	"gtreqless;": "⋛",
	"gvertneqq;": "≩︀",
	"heartsuit;": "♥",
	"HumpEqual;": "≏",
	"LeftArrow;": "←",
	"Leftarrow;": "⇐",
	"leftarrow;": "←",
	"LeftFloor;": "⌊",
	"lesseqgtr;": "⋚",
	"LessTilde;": "≲",
	"lvertneqq;": "≨︀",
	"Mellintrf;": "ℳ",
	"MinusPlus;": "∓",
	"ngeqslant;": "⩾̸",
	"nleqslant;": "⩽̸",
	"NotCupCap;": "≭",
	"NotExists;": "∄",
	"NotSubset;": "⊂⃒",
	"nparallel;": "∦",
	"nshortmid;": "∤",
	"nsubseteq;": "⊈",
	"nsupseteq;": "⊉",
	"OverBrace;": "⏞",
	"pitchfork;": "⋔",
	"PlusMinus;": "±",
	"rationals;": "ℚ",
	"spadesuit;": "♠",
	"subseteqq;": "⫅",
	"subsetneq;": "⊊",
	"supseteqq;": "⫆",
	"supsetneq;": "⊋",
	"Therefore;": "∴",
	"therefore;": "∴",
	"ThinSpace;": " ",
	"triangleq;": "≜",
	"TripleDot;": "⃛",
	"UnionPlus;": "⊎",
	"varpropto;": "∝",
	"Bernoullis;": "ℬ",
	"circledast;": "⊛",
	"CirclePlus;": "⊕",
	"complement;": "∁",
	"curlywedge;": "⋏",
	"eqslantgtr;": "⪖",
	"EqualTilde;": "≂",
	"Fouriertrf;": "ℱ",
	"gtreqqless;": "⪌",
	"ImaginaryI;": "ⅈ",
	"Laplacetrf;": "ℒ",
	"LeftVector;": "↼",
	"lessapprox;": "⪅",
	"lesseqqgtr;": "⪋",
	"Lleftarrow;": "⇚",
	"lmoustache;": "⎰",
	"longmapsto;": "⟼",
	"mapstodown;": "↧",
	"mapstoleft;": "↤",
	"nLeftarrow;": "⇍",
	"nleftarrow;": "↚",
	"NotElement;": "∉",
	"NotGreater;": "≯",
	"nsubseteqq;": "⫅̸",
	"nsupseteqq;": "⫆̸",
	"precapprox;": "⪷",
	"Proportion;": "∷",
	"RightArrow;": "→",
	"Rightarrow;": "⇒",
	"rightarrow;": "→",
	"RightFloor;": "⌋",
	"rmoustache;": "⎱",
	"sqsubseteq;": "⊑",
	"sqsupseteq;": "⊒",
	"subsetneqq;": "⫋",
	"succapprox;": "⪸",
	"supsetneqq;": "⫌",
	"ThickSpace;": "  ",
	"TildeEqual;": "≃",
	"TildeTilde;": "≈",
	"UnderBrace;": "⏟",
	"UpArrowBar;": "⤒",
	"UpTeeArrow;": "↥",
	"upuparrows;": "⇈",
	"varepsilon;": "ϵ",
	"varnothing;": "∅",
	"backepsilon;": "϶",
	"blacksquare;": "▪",
	"circledcirc;": "⊚",
	"circleddash;": "⊝",
	"CircleMinus;": "⊖",
	"CircleTimes;": "⊗",
	"curlyeqprec;": "⋞",
	"curlyeqsucc;": "⋟",
	"diamondsuit;": "♦",
	"eqslantless;": "⪕",
	"Equilibrium;": "⇌",
	"expectation;": "ℰ",
	"GreaterLess;": "≷",
	"LeftCeiling;": "⌈",
	"LessGreater;": "≶",
	"MediumSpace;": " ",
	"NotLessLess;": "≪̸",
	"NotPrecedes;": "⊀",
	"NotSucceeds;": "⊁",
	"NotSuperset;": "⊃⃒",
	"nRightarrow;": "⇏",
	"nrightarrow;": "↛",
	"OverBracket;": "⎴",
	"preccurlyeq;": "≼",
	"precnapprox;": "⪹",
	"quaternions;": "ℍ",
	"RightVector;": "⇀",
	"Rrightarrow;": "⇛",
	"RuleDelayed;": "⧴",
	"SmallCircle;": "∘",
	"SquareUnion;": "⊔",
	"straightphi;": "ϕ",
	"SubsetEqual;": "⊆",
	"succcurlyeq;": "≽",
	"succnapprox;": "⪺",
	"thickapprox;": "≈",
	"UpDownArrow;": "↕",
	"Updownarrow;": "⇕",
	"updownarrow;": "↕",
	"VerticalBar;": "∣",
	"blacklozenge;": "⧫",
	"DownArrowBar;": "⤓",
	"DownTeeArrow;": "↧",
	"ExponentialE;": "ⅇ",
	"exponentiale;": "ⅇ",
	"GreaterEqual;": "≥",
	"GreaterTilde;": "≳",
	"HilbertSpace;": "ℋ",
	"HumpDownHump;": "≎",
	"Intersection;": "⋂",
	"LeftArrowBar;": "⇤",
	"LeftTeeArrow;": "↤",
	"LeftTriangle;": "⊲",
	"LeftUpVector;": "↿",
	"NotCongruent;": "≢",
	"NotHumpEqual;": "≏̸",
	"NotLessEqual;": "≰",
	"NotLessTilde;": "≴",
	"Proportional;": "∝",
	"RightCeiling;": "⌉",
	"risingdotseq;": "≓",
	"RoundImplies;": "⥰",
	"ShortUpArrow;": "↑",
	"SquareSubset;": "⊏",
	"triangledown;": "▿",
	"triangleleft;": "◃",
	"UnderBracket;": "⎵",
	"varsubsetneq;": "⊊︀",
	"varsupsetneq;": "⊋︀",
	"VerticalLine;": "|",
	"ApplyFunction;": "⁡",
	"bigtriangleup;": "△",
	"blacktriangle;": "▴",
	"DifferentialD;": "ⅆ",
	"divideontimes;": "⋇",
	"DoubleLeftTee;": "⫤",
	"DoubleUpArrow;": "⇑",
	"fallingdotseq;": "≒",
	"hookleftarrow;": "↩",
	"leftarrowtail;": "↢",
	"leftharpoonup;": "↼",
	"LeftTeeVector;": "⥚",
	"LeftVectorBar;": "⥒",
	"LessFullEqual;": "≦",
	"LongLeftArrow;": "⟵",
	"Longleftarrow;": "⟸",
	"longleftarrow;": "⟵",
	"looparrowleft;": "↫",
	"measuredangle;": "∡",
	"NotEqualTilde;": "≂̸",
	"NotTildeEqual;": "≄",
	"NotTildeTilde;": "≉",
	"ntriangleleft;": "⋪",
	"Poincareplane;": "ℌ",
	"PrecedesEqual;": "⪯",
	"PrecedesTilde;": "≾",
	"RightArrowBar;": "⇥",
	"RightTeeArrow;": "↦",
	"RightTriangle;": "⊳",
	"RightUpVector;": "↾",
	"shortparallel;": "∥",
	"smallsetminus;": "∖",
	"SucceedsEqual;": "⪰",
	"SucceedsTilde;": "≿",
	"SupersetEqual;": "⊇",
	"triangleright;": "▹",
	"UpEquilibrium;": "⥮",
	"upharpoonleft;": "↿",
	"varsubsetneqq;": "⫋︀",
	"varsupsetneqq;": "⫌︀",
	"VerticalTilde;": "≀",
	"VeryThinSpace;": " ",
	"curvearrowleft;": "↶",
	"DiacriticalDot;": "˙",
	"doublebarwedge;": "⌆",
	"DoubleRightTee;": "⊨",
	"downdownarrows;": "⇊",
	"DownLeftVector;": "↽",
	"GreaterGreater;": "⪢",
	"hookrightarrow;": "↪",
	"HorizontalLine;": "─",
	"InvisibleComma;": "⁣",
	"InvisibleTimes;": "⁢",
	"LeftDownVector;": "⇃",
	"leftleftarrows;": "⇇",
	"LeftRightArrow;": "↔",
	"Leftrightarrow;": "⇔",
	"leftrightarrow;": "↔",
	"leftthreetimes;": "⋋",
	"LessSlantEqual;": "⩽",
	"LongRightArrow;": "⟶",
	"Longrightarrow;": "⟹",
	"longrightarrow;": "⟶",
	"looparrowright;": "↬",
	"LowerLeftArrow;": "↙",
	"NestedLessLess;": "≪",
	"NotGreaterLess;": "≹",
	"NotLessGreater;": "≸",
	"NotSubsetEqual;": "⊈",
	"NotVerticalBar;": "∤",
	"nshortparallel;": "∦",
	"ntriangleright;": "⋫",
	"OpenCurlyQuote;": "‘",
	"ReverseElement;": "∋",
	"rightarrowtail;": "↣",
	"rightharpoonup;": "⇀",
	"RightTeeVector;": "⥛",
	"RightVectorBar;": "⥓",
	"ShortDownArrow;": "↓",
	"ShortLeftArrow;": "←",
	"SquareSuperset;": "⊐",
	"TildeFullEqual;": "≅",
	"trianglelefteq;": "⊴",
	"upharpoonright;": "↾",
	"UpperLeftArrow;": "↖",
	"ZeroWidthSpace;": "​",
	"bigtriangledown;": "▽",
	"circlearrowleft;": "↺",
	"CloseCurlyQuote;": "’",
	"ContourIntegral;": "∮",
	"curvearrowright;": "↷",
	"DoubleDownArrow;": "⇓",
	"DoubleLeftArrow;": "⇐",
	"downharpoonleft;": "⇃",
	"DownRightVector;": "⇁",
	"leftharpoondown;": "↽",
	"leftrightarrows;": "⇆",
	"LeftRightVector;": "⥎",
	"LeftTriangleBar;": "⧏",
	"LeftUpTeeVector;": "⥠",
	"LeftUpVectorBar;": "⥘",
	"LowerRightArrow;": "↘",
	"nLeftrightarrow;": "⇎",
	"nleftrightarrow;": "↮",
	"NotGreaterEqual;": "≱",
	"NotGreaterTilde;": "≵",
	"NotHumpDownHump;": "≎̸",
	"NotLeftTriangle;": "⋪",
	"NotSquareSubset;": "⊏̸",
	"ntrianglelefteq;": "⋬",
	"OverParenthesis;": "⏜",
	"RightDownVector;": "⇂",
	"rightleftarrows;": "⇄",
	"rightsquigarrow;": "↝",
	"rightthreetimes;": "⋌",
	"ShortRightArrow;": "→",
	"straightepsilon;": "ϵ",
	"trianglerighteq;": "⊵",
	"UpperRightArrow;": "↗",
	"vartriangleleft;": "⊲",
	"circlearrowright;": "↻",
	"DiacriticalAcute;": "´",
	"DiacriticalGrave;": "`",
	"DiacriticalTilde;": "˜",
	"DoubleRightArrow;": "⇒",
	"DownArrowUpArrow;": "⇵",
	"downharpoonright;": "⇂",
	"EmptySmallSquare;": "◻",
	"GreaterEqualLess;": "⋛",
	"GreaterFullEqual;": "≧",
	"LeftAngleBracket;": "⟨",
	"LeftUpDownVector;": "⥑",
	"LessEqualGreater;": "⋚",
	"NonBreakingSpace;": " ",
	"NotPrecedesEqual;": "⪯̸",
	"NotRightTriangle;": "⋫",
	"NotSucceedsEqual;": "⪰̸",
	"NotSucceedsTilde;": "≿̸",
	"NotSupersetEqual;": "⊉",
	"ntrianglerighteq;": "⋭",
	"rightharpoondown;": "⇁",
	"rightrightarrows;": "⇉",
	"RightTriangleBar;": "⧐",
	"RightUpTeeVector;": "⥜",
	"RightUpVectorBar;": "⥔",
	"twoheadleftarrow;": "↞",
	"UnderParenthesis;": "⏝",
	"UpArrowDownArrow;": "⇅",
	"vartriangleright;": "⊳",
	"blacktriangledown;": "▾",
	"blacktriangleleft;": "◂",
	"DoubleUpDownArrow;": "⇕",
	"DoubleVerticalBar;": "∥",
	"DownLeftTeeVector;": "⥞",
	"DownLeftVectorBar;": "⥖",
	"FilledSmallSquare;": "◼",
	"GreaterSlantEqual;": "⩾",
	"LeftDoubleBracket;": "⟦",
	"LeftDownTeeVector;": "⥡",
	"LeftDownVectorBar;": "⥙",
	"leftrightharpoons;": "⇋",
	"LeftTriangleEqual;": "⊴",
	"NegativeThinSpace;": "​",
	"NotGreaterGreater;": "≫̸",
	"NotLessSlantEqual;": "⩽̸",
	"NotNestedLessLess;": "⪡̸",
	"NotReverseElement;": "∌",
	"NotSquareSuperset;": "⊐̸",
	"NotTildeFullEqual;": "≇",
	"RightAngleBracket;": "⟩",
	"rightleftharpoons;": "⇌",
	"RightUpDownVector;": "⥏",
	"SquareSubsetEqual;": "⊑",
	"twoheadrightarrow;": "↠",
	"VerticalSeparator;": "❘",
	"blacktriangleright;": "▸",
	"DownRightTeeVector;": "⥟",
	"DownRightVectorBar;": "⥗",
	"LongLeftRightArrow;": "⟷",
	"Longleftrightarrow;": "⟺",
	"longleftrightarrow;": "⟷",
	"NegativeThickSpace;": "​",
	"NotLeftTriangleBar;": "⧏̸",
	"PrecedesSlantEqual;": "≼",
	"ReverseEquilibrium;": "⇋",
	"RightDoubleBracket;": "⟧",
	"RightDownTeeVector;": "⥝",
	"RightDownVectorBar;": "⥕",
	"RightTriangleEqual;": "⊵",
	"SquareIntersection;": "⊓",
	"SucceedsSlantEqual;": "≽",
	"DoubleLongLeftArrow;": "⟸",
	"DownLeftRightVector;": "⥐",
	"LeftArrowRightArrow;": "⇆",
	"leftrightsquigarrow;": "↭",
	"NegativeMediumSpace;": "​",
	"NotGreaterFullEqual;": "≧̸",
	"NotRightTriangleBar;": "⧐̸",
	"RightArrowLeftArrow;": "⇄",
	"SquareSupersetEqual;": "⊒",
	"CapitalDifferentialD;": "ⅅ",
	"DoubleLeftRightArrow;": "⇔",
	"DoubleLongRightArrow;": "⟹",
	"EmptyVerySmallSquare;": "▫",
	"NestedGreaterGreater;": "≫",
	"NotDoubleVerticalBar;": "∦",
	"NotGreaterSlantEqual;": "⩾̸",
	"NotLeftTriangleEqual;": "⋬",
	"NotSquareSubsetEqual;": "⋢",
	"OpenCurlyDoubleQuote;": "“",
	"ReverseUpEquilibrium;": "⥯",
	"CloseCurlyDoubleQuote;": "”",
	"DoubleContourIntegral;": "∯",
	"FilledVerySmallSquare;": "▪",
	"NegativeVeryThinSpace;": "​",
	"NotPrecedesSlantEqual;": "⋠",
	"NotRightTriangleEqual;": "⋭",
	"NotSucceedsSlantEqual;": "⋡",
	"DiacriticalDoubleAcute;": "˝",
	"NotSquareSupersetEqual;": "⋣",
	"NotNestedGreaterGreater;": "⪢̸",
	"ClockwiseContourIntegral;": "∲",
	"DoubleLongLeftRightArrow;": "⟺",
	"CounterClockwiseContourIntegral;": "∳"
};

// lazy compute this to make this file tree-shakable for browser
let maxCRNameLength;
const decodeHtml = (rawText, asAttr) => {
    let offset = 0;
    const end = rawText.length;
    let decodedText = '';
    function advance(length) {
        offset += length;
        rawText = rawText.slice(length);
    }
    while (offset < end) {
        const head = /&(?:#x?)?/i.exec(rawText);
        if (!head || offset + head.index >= end) {
            const remaining = end - offset;
            decodedText += rawText.slice(0, remaining);
            advance(remaining);
            break;
        }
        // Advance to the "&".
        decodedText += rawText.slice(0, head.index);
        advance(head.index);
        if (head[0] === '&') {
            // Named character reference.
            let name = '';
            let value = undefined;
            if (/[0-9a-z]/i.test(rawText[1])) {
                if (!maxCRNameLength) {
                    maxCRNameLength = Object.keys(namedCharacterReferences).reduce((max, name) => Math.max(max, name.length), 0);
                }
                for (let length = maxCRNameLength; !value && length > 0; --length) {
                    name = rawText.substr(1, length);
                    value = namedCharacterReferences[name];
                }
                if (value) {
                    const semi = name.endsWith(';');
                    if (asAttr &&
                        !semi &&
                        /[=a-z0-9]/i.test(rawText[name.length + 1] || '')) {
                        decodedText += '&' + name;
                        advance(1 + name.length);
                    }
                    else {
                        decodedText += value;
                        advance(1 + name.length);
                    }
                }
                else {
                    decodedText += '&' + name;
                    advance(1 + name.length);
                }
            }
            else {
                decodedText += '&';
                advance(1);
            }
        }
        else {
            // Numeric character reference.
            const hex = head[0] === '&#x';
            const pattern = hex ? /^&#x([0-9a-f]+);?/i : /^&#([0-9]+);?/;
            const body = pattern.exec(rawText);
            if (!body) {
                decodedText += head[0];
                advance(head[0].length);
            }
            else {
                // https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
                let cp = Number.parseInt(body[1], hex ? 16 : 10);
                if (cp === 0) {
                    cp = 0xfffd;
                }
                else if (cp > 0x10ffff) {
                    cp = 0xfffd;
                }
                else if (cp >= 0xd800 && cp <= 0xdfff) {
                    cp = 0xfffd;
                }
                else if ((cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe) ;
                else if ((cp >= 0x01 && cp <= 0x08) ||
                    cp === 0x0b ||
                    (cp >= 0x0d && cp <= 0x1f) ||
                    (cp >= 0x7f && cp <= 0x9f)) {
                    cp = CCR_REPLACEMENTS[cp] || cp;
                }
                decodedText += String.fromCodePoint(cp);
                advance(body[0].length);
            }
        }
    }
    return decodedText;
};
// https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
const CCR_REPLACEMENTS = {
    0x80: 0x20ac,
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x8e: 0x017d,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9e: 0x017e,
    0x9f: 0x0178
};

const isRawTextContainer = /*#__PURE__*/ makeMap('style,iframe,script,noscript', true);
const parserOptions = {
    isVoidTag,
    isNativeTag: tag => isHTMLTag(tag) || isSVGTag(tag),
    isPreTag: tag => tag === 'pre',
    decodeEntities:  decodeHtml,
    isBuiltInComponent: (tag) => {
        if (isBuiltInType(tag, `Transition`)) {
            return TRANSITION;
        }
        else if (isBuiltInType(tag, `TransitionGroup`)) {
            return TRANSITION_GROUP;
        }
    },
    // https://html.spec.whatwg.org/multipage/parsing.html#tree-construction-dispatcher
    getNamespace(tag, parent) {
        let ns = parent ? parent.ns : 0 /* HTML */;
        if (parent && ns === 2 /* MATH_ML */) {
            if (parent.tag === 'annotation-xml') {
                if (tag === 'svg') {
                    return 1 /* SVG */;
                }
                if (parent.props.some(a => a.type === 6 /* ATTRIBUTE */ &&
                    a.name === 'encoding' &&
                    a.value != null &&
                    (a.value.content === 'text/html' ||
                        a.value.content === 'application/xhtml+xml'))) {
                    ns = 0 /* HTML */;
                }
            }
            else if (/^m(?:[ions]|text)$/.test(parent.tag) &&
                tag !== 'mglyph' &&
                tag !== 'malignmark') {
                ns = 0 /* HTML */;
            }
        }
        else if (parent && ns === 1 /* SVG */) {
            if (parent.tag === 'foreignObject' ||
                parent.tag === 'desc' ||
                parent.tag === 'title') {
                ns = 0 /* HTML */;
            }
        }
        if (ns === 0 /* HTML */) {
            if (tag === 'svg') {
                return 1 /* SVG */;
            }
            if (tag === 'math') {
                return 2 /* MATH_ML */;
            }
        }
        return ns;
    },
    // https://html.spec.whatwg.org/multipage/parsing.html#parsing-html-fragments
    getTextMode({ tag, ns }) {
        if (ns === 0 /* HTML */) {
            if (tag === 'textarea' || tag === 'title') {
                return 1 /* RCDATA */;
            }
            if (isRawTextContainer(tag)) {
                return 2 /* RAWTEXT */;
            }
        }
        return 0 /* DATA */;
    }
};

// Parse inline CSS strings for static style attributes into an object.
// This is a NodeTransform since it works on the static `style` attribute and
// converts it into a dynamic equivalent:
// style="color: red" -> :style='{ "color": "red" }'
// It is then processed by `transformElement` and included in the generated
// props.
const transformStyle = node => {
    if (node.type === 1 /* ELEMENT */) {
        node.props.forEach((p, i) => {
            if (p.type === 6 /* ATTRIBUTE */ && p.name === 'style' && p.value) {
                // replace p with an expression node
                node.props[i] = {
                    type: 7 /* DIRECTIVE */,
                    name: `bind`,
                    arg: createSimpleExpression(`style`, true, p.loc),
                    exp: parseInlineCSS(p.value.content, p.loc),
                    modifiers: [],
                    loc: p.loc
                };
            }
        });
    }
};
const parseInlineCSS = (cssText, loc) => {
    const normalized = parseStringStyle(cssText);
    return createSimpleExpression(JSON.stringify(normalized), false, loc, 3 /* CAN_STRINGIFY */);
};

function createDOMCompilerError(code, loc) {
    return createCompilerError(code, loc,  DOMErrorMessages );
}
const DOMErrorMessages = {
    [49 /* X_V_HTML_NO_EXPRESSION */]: `v-html is missing expression.`,
    [50 /* X_V_HTML_WITH_CHILDREN */]: `v-html will override element children.`,
    [51 /* X_V_TEXT_NO_EXPRESSION */]: `v-text is missing expression.`,
    [52 /* X_V_TEXT_WITH_CHILDREN */]: `v-text will override element children.`,
    [53 /* X_V_MODEL_ON_INVALID_ELEMENT */]: `v-model can only be used on <input>, <textarea> and <select> elements.`,
    [54 /* X_V_MODEL_ARG_ON_ELEMENT */]: `v-model argument is not supported on plain elements.`,
    [55 /* X_V_MODEL_ON_FILE_INPUT_ELEMENT */]: `v-model cannot be used on file inputs since they are read-only. Use a v-on:change listener instead.`,
    [56 /* X_V_MODEL_UNNECESSARY_VALUE */]: `Unnecessary value binding used alongside v-model. It will interfere with v-model's behavior.`,
    [57 /* X_V_SHOW_NO_EXPRESSION */]: `v-show is missing expression.`,
    [58 /* X_TRANSITION_INVALID_CHILDREN */]: `<Transition> expects exactly one child element or component.`,
    [59 /* X_IGNORED_SIDE_EFFECT_TAG */]: `Tags with side effect (<script> and <style>) are ignored in client component templates.`
};

const transformVHtml = (dir, node, context) => {
    const { exp, loc } = dir;
    if (!exp) {
        context.onError(createDOMCompilerError(49 /* X_V_HTML_NO_EXPRESSION */, loc));
    }
    if (node.children.length) {
        context.onError(createDOMCompilerError(50 /* X_V_HTML_WITH_CHILDREN */, loc));
        node.children.length = 0;
    }
    return {
        props: [
            createObjectProperty(createSimpleExpression(`innerHTML`, true, loc), exp || createSimpleExpression('', true))
        ]
    };
};

const transformVText = (dir, node, context) => {
    const { exp, loc } = dir;
    if (!exp) {
        context.onError(createDOMCompilerError(51 /* X_V_TEXT_NO_EXPRESSION */, loc));
    }
    if (node.children.length) {
        context.onError(createDOMCompilerError(52 /* X_V_TEXT_WITH_CHILDREN */, loc));
        node.children.length = 0;
    }
    return {
        props: [
            createObjectProperty(createSimpleExpression(`textContent`, true), exp
                ? createCallExpression(context.helperString(TO_DISPLAY_STRING), [exp], loc)
                : createSimpleExpression('', true))
        ]
    };
};

const transformModel$1 = (dir, node, context) => {
    const baseResult = transformModel(dir, node, context);
    // base transform has errors OR component v-model (only need props)
    if (!baseResult.props.length || node.tagType === 1 /* COMPONENT */) {
        return baseResult;
    }
    if (dir.arg) {
        context.onError(createDOMCompilerError(54 /* X_V_MODEL_ARG_ON_ELEMENT */, dir.arg.loc));
    }
    function checkDuplicatedValue() {
        const value = findProp(node, 'value');
        if (value) {
            context.onError(createDOMCompilerError(56 /* X_V_MODEL_UNNECESSARY_VALUE */, value.loc));
        }
    }
    const { tag } = node;
    const isCustomElement = context.isCustomElement(tag);
    if (tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        isCustomElement) {
        let directiveToUse = V_MODEL_TEXT;
        let isInvalidType = false;
        if (tag === 'input' || isCustomElement) {
            const type = findProp(node, `type`);
            if (type) {
                if (type.type === 7 /* DIRECTIVE */) {
                    // :type="foo"
                    directiveToUse = V_MODEL_DYNAMIC;
                }
                else if (type.value) {
                    switch (type.value.content) {
                        case 'radio':
                            directiveToUse = V_MODEL_RADIO;
                            break;
                        case 'checkbox':
                            directiveToUse = V_MODEL_CHECKBOX;
                            break;
                        case 'file':
                            isInvalidType = true;
                            context.onError(createDOMCompilerError(55 /* X_V_MODEL_ON_FILE_INPUT_ELEMENT */, dir.loc));
                            break;
                        default:
                            // text type
                             checkDuplicatedValue();
                            break;
                    }
                }
            }
            else if (hasDynamicKeyVBind(node)) {
                // element has bindings with dynamic keys, which can possibly contain
                // "type".
                directiveToUse = V_MODEL_DYNAMIC;
            }
            else {
                // text type
                 checkDuplicatedValue();
            }
        }
        else if (tag === 'select') {
            directiveToUse = V_MODEL_SELECT;
        }
        else {
            // textarea
             checkDuplicatedValue();
        }
        // inject runtime directive
        // by returning the helper symbol via needRuntime
        // the import will replaced a resolveDirective call.
        if (!isInvalidType) {
            baseResult.needRuntime = context.helper(directiveToUse);
        }
    }
    else {
        context.onError(createDOMCompilerError(53 /* X_V_MODEL_ON_INVALID_ELEMENT */, dir.loc));
    }
    // native vmodel doesn't need the `modelValue` props since they are also
    // passed to the runtime as `binding.value`. removing it reduces code size.
    baseResult.props = baseResult.props.filter(p => !(p.key.type === 4 /* SIMPLE_EXPRESSION */ &&
        p.key.content === 'modelValue'));
    return baseResult;
};

const isEventOptionModifier = /*#__PURE__*/ makeMap(`passive,once,capture`);
const isNonKeyModifier = /*#__PURE__*/ makeMap(
// event propagation management
`stop,prevent,self,` +
    // system modifiers + exact
    `ctrl,shift,alt,meta,exact,` +
    // mouse
    `middle`);
// left & right could be mouse or key modifiers based on event type
const maybeKeyModifier = /*#__PURE__*/ makeMap('left,right');
const isKeyboardEvent = /*#__PURE__*/ makeMap(`onkeyup,onkeydown,onkeypress`, true);
const resolveModifiers = (key, modifiers) => {
    const keyModifiers = [];
    const nonKeyModifiers = [];
    const eventOptionModifiers = [];
    for (let i = 0; i < modifiers.length; i++) {
        const modifier = modifiers[i];
        if (isEventOptionModifier(modifier)) {
            // eventOptionModifiers: modifiers for addEventListener() options,
            // e.g. .passive & .capture
            eventOptionModifiers.push(modifier);
        }
        else {
            // runtimeModifiers: modifiers that needs runtime guards
            if (maybeKeyModifier(modifier)) {
                if (isStaticExp(key)) {
                    if (isKeyboardEvent(key.content)) {
                        keyModifiers.push(modifier);
                    }
                    else {
                        nonKeyModifiers.push(modifier);
                    }
                }
                else {
                    keyModifiers.push(modifier);
                    nonKeyModifiers.push(modifier);
                }
            }
            else {
                if (isNonKeyModifier(modifier)) {
                    nonKeyModifiers.push(modifier);
                }
                else {
                    keyModifiers.push(modifier);
                }
            }
        }
    }
    return {
        keyModifiers,
        nonKeyModifiers,
        eventOptionModifiers
    };
};
const transformClick = (key, event) => {
    const isStaticClick = isStaticExp(key) && key.content.toLowerCase() === 'onclick';
    return isStaticClick
        ? createSimpleExpression(event, true)
        : key.type !== 4 /* SIMPLE_EXPRESSION */
            ? createCompoundExpression([
                `(`,
                key,
                `) === "onClick" ? "${event}" : (`,
                key,
                `)`
            ])
            : key;
};
const transformOn$1 = (dir, node, context) => {
    return transformOn(dir, node, context, baseResult => {
        const { modifiers } = dir;
        if (!modifiers.length)
            return baseResult;
        let { key, value: handlerExp } = baseResult.props[0];
        const { keyModifiers, nonKeyModifiers, eventOptionModifiers } = resolveModifiers(key, modifiers);
        // normalize click.right and click.middle since they don't actually fire
        if (nonKeyModifiers.includes('right')) {
            key = transformClick(key, `onContextmenu`);
        }
        if (nonKeyModifiers.includes('middle')) {
            key = transformClick(key, `onMouseup`);
        }
        if (nonKeyModifiers.length) {
            handlerExp = createCallExpression(context.helper(V_ON_WITH_MODIFIERS), [
                handlerExp,
                JSON.stringify(nonKeyModifiers)
            ]);
        }
        if (keyModifiers.length &&
            // if event name is dynamic, always wrap with keys guard
            (!isStaticExp(key) || isKeyboardEvent(key.content))) {
            handlerExp = createCallExpression(context.helper(V_ON_WITH_KEYS), [
                handlerExp,
                JSON.stringify(keyModifiers)
            ]);
        }
        if (eventOptionModifiers.length) {
            const modifierPostfix = eventOptionModifiers.map(capitalize).join('');
            key = isStaticExp(key)
                ? createSimpleExpression(`${key.content}${modifierPostfix}`, true)
                : createCompoundExpression([`(`, key, `) + "${modifierPostfix}"`]);
        }
        return {
            props: [createObjectProperty(key, handlerExp)]
        };
    });
};

const transformShow = (dir, node, context) => {
    const { exp, loc } = dir;
    if (!exp) {
        context.onError(createDOMCompilerError(57 /* X_V_SHOW_NO_EXPRESSION */, loc));
    }
    return {
        props: [],
        needRuntime: context.helper(V_SHOW)
    };
};

const warnTransitionChildren = (node, context) => {
    if (node.type === 1 /* ELEMENT */ &&
        node.tagType === 1 /* COMPONENT */) {
        const component = context.isBuiltInComponent(node.tag);
        if (component === TRANSITION) {
            return () => {
                if (node.children.length && hasMultipleChildren(node)) {
                    context.onError(createDOMCompilerError(58 /* X_TRANSITION_INVALID_CHILDREN */, {
                        start: node.children[0].loc.start,
                        end: node.children[node.children.length - 1].loc.end,
                        source: ''
                    }));
                }
            };
        }
    }
};
function hasMultipleChildren(node) {
    // #1352 filter out potential comment nodes.
    const children = (node.children = node.children.filter(c => c.type !== 3 /* COMMENT */));
    const child = children[0];
    return (children.length !== 1 ||
        child.type === 11 /* FOR */ ||
        (child.type === 9 /* IF */ && child.branches.some(hasMultipleChildren)));
}

/**
 * This module is Node-only.
 */
/**
 * Turn eligible hoisted static trees into stringified static nodes, e.g.
 *
 * ```js
 * const _hoisted_1 = createStaticVNode(`<div class="foo">bar</div>`)
 * ```
 *
 * A single static vnode can contain stringified content for **multiple**
 * consecutive nodes (element and plain text), called a "chunk".
 * `@vue/runtime-dom` will create the content via innerHTML in a hidden
 * container element and insert all the nodes in place. The call must also
 * provide the number of nodes contained in the chunk so that during hydration
 * we can know how many nodes the static vnode should adopt.
 *
 * The optimization scans a children list that contains hoisted nodes, and
 * tries to find the largest chunk of consecutive hoisted nodes before running
 * into a non-hoisted node or the end of the list. A chunk is then converted
 * into a single static vnode and replaces the hoisted expression of the first
 * node in the chunk. Other nodes in the chunk are considered "merged" and
 * therefore removed from both the hoist list and the children array.
 *
 * This optimization is only performed in Node.js.
 */
const stringifyStatic = (children, context, parent) => {
    if (parent.type === 1 /* ELEMENT */ &&
        (parent.tagType === 1 /* COMPONENT */ ||
            parent.tagType === 3 /* TEMPLATE */)) {
        return;
    }
    let nc = 0; // current node count
    let ec = 0; // current element with binding count
    const currentChunk = [];
    const stringifyCurrentChunk = (currentIndex) => {
        if (nc >= 20 /* NODE_COUNT */ ||
            ec >= 5 /* ELEMENT_WITH_BINDING_COUNT */) {
            // combine all currently eligible nodes into a single static vnode call
            const staticCall = createCallExpression(context.helper(CREATE_STATIC), [
                JSON.stringify(currentChunk.map(node => stringifyNode(node, context)).join('')),
                // the 2nd argument indicates the number of DOM nodes this static vnode
                // will insert / hydrate
                String(currentChunk.length)
            ]);
            // replace the first node's hoisted expression with the static vnode call
            replaceHoist(currentChunk[0], staticCall, context);
            if (currentChunk.length > 1) {
                for (let i = 1; i < currentChunk.length; i++) {
                    // for the merged nodes, set their hoisted expression to null
                    replaceHoist(currentChunk[i], null, context);
                }
                // also remove merged nodes from children
                const deleteCount = currentChunk.length - 1;
                children.splice(currentIndex - currentChunk.length + 1, deleteCount);
                return deleteCount;
            }
        }
        return 0;
    };
    let i = 0;
    for (; i < children.length; i++) {
        const child = children[i];
        const hoisted = getHoistedNode(child);
        if (hoisted) {
            // presence of hoisted means child must be a stringifiable node
            const node = child;
            const result = analyzeNode(node);
            if (result) {
                // node is stringifiable, record state
                nc += result[0];
                ec += result[1];
                currentChunk.push(node);
                continue;
            }
        }
        // we only reach here if we ran into a node that is not stringifiable
        // check if currently analyzed nodes meet criteria for stringification.
        // adjust iteration index
        i -= stringifyCurrentChunk(i);
        // reset state
        nc = 0;
        ec = 0;
        currentChunk.length = 0;
    }
    // in case the last node was also stringifiable
    stringifyCurrentChunk(i);
};
const getHoistedNode = (node) => ((node.type === 1 /* ELEMENT */ && node.tagType === 0 /* ELEMENT */) ||
    node.type == 12 /* TEXT_CALL */) &&
    node.codegenNode &&
    node.codegenNode.type === 4 /* SIMPLE_EXPRESSION */ &&
    node.codegenNode.hoisted;
const dataAriaRE = /^(data|aria)-/;
const isStringifiableAttr = (name) => {
    return isKnownAttr(name) || dataAriaRE.test(name);
};
const replaceHoist = (node, replacement, context) => {
    const hoistToReplace = node.codegenNode.hoisted;
    context.hoists[context.hoists.indexOf(hoistToReplace)] = replacement;
};
const isNonStringifiable = /*#__PURE__*/ makeMap(`caption,thead,tr,th,tbody,td,tfoot,colgroup,col`);
/**
 * for a hoisted node, analyze it and return:
 * - false: bailed (contains runtime constant)
 * - [nc, ec] where
 *   - nc is the number of nodes inside
 *   - ec is the number of element with bindings inside
 */
function analyzeNode(node) {
    if (node.type === 1 /* ELEMENT */ && isNonStringifiable(node.tag)) {
        return false;
    }
    if (node.type === 12 /* TEXT_CALL */) {
        return [1, 0];
    }
    let nc = 1; // node count
    let ec = node.props.length > 0 ? 1 : 0; // element w/ binding count
    let bailed = false;
    const bail = () => {
        bailed = true;
        return false;
    };
    // TODO: check for cases where using innerHTML will result in different
    // output compared to imperative node insertions.
    // probably only need to check for most common case
    // i.e. non-phrasing-content tags inside `<p>`
    function walk(node) {
        for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i];
            // bail on non-attr bindings
            if (p.type === 6 /* ATTRIBUTE */ && !isStringifiableAttr(p.name)) {
                return bail();
            }
            if (p.type === 7 /* DIRECTIVE */ && p.name === 'bind') {
                // bail on non-attr bindings
                if (p.arg &&
                    (p.arg.type === 8 /* COMPOUND_EXPRESSION */ ||
                        (p.arg.isStatic && !isStringifiableAttr(p.arg.content)))) {
                    return bail();
                }
            }
        }
        for (let i = 0; i < node.children.length; i++) {
            nc++;
            const child = node.children[i];
            if (child.type === 1 /* ELEMENT */) {
                if (child.props.length > 0) {
                    ec++;
                }
                walk(child);
                if (bailed) {
                    return false;
                }
            }
        }
        return true;
    }
    return walk(node) ? [nc, ec] : false;
}
function stringifyNode(node, context) {
    if (isString(node)) {
        return node;
    }
    if (isSymbol(node)) {
        return ``;
    }
    switch (node.type) {
        case 1 /* ELEMENT */:
            return stringifyElement(node, context);
        case 2 /* TEXT */:
            return escapeHtml(node.content);
        case 3 /* COMMENT */:
            return `<!--${escapeHtml(node.content)}-->`;
        case 5 /* INTERPOLATION */:
            return escapeHtml(toDisplayString(evaluateConstant(node.content)));
        case 8 /* COMPOUND_EXPRESSION */:
            return escapeHtml(evaluateConstant(node));
        case 12 /* TEXT_CALL */:
            return stringifyNode(node.content, context);
        default:
            // static trees will not contain if/for nodes
            return '';
    }
}
function stringifyElement(node, context) {
    let res = `<${node.tag}`;
    for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i];
        if (p.type === 6 /* ATTRIBUTE */) {
            res += ` ${p.name}`;
            if (p.value) {
                res += `="${escapeHtml(p.value.content)}"`;
            }
        }
        else if (p.type === 7 /* DIRECTIVE */ && p.name === 'bind') {
            // constant v-bind, e.g. :foo="1"
            let evaluated = evaluateConstant(p.exp);
            const arg = p.arg && p.arg.content;
            if (arg === 'class') {
                evaluated = normalizeClass(evaluated);
            }
            else if (arg === 'style') {
                evaluated = stringifyStyle(normalizeStyle(evaluated));
            }
            res += ` ${p.arg.content}="${escapeHtml(evaluated)}"`;
        }
    }
    if (context.scopeId) {
        res += ` ${context.scopeId}`;
    }
    res += `>`;
    for (let i = 0; i < node.children.length; i++) {
        res += stringifyNode(node.children[i], context);
    }
    if (!isVoidTag(node.tag)) {
        res += `</${node.tag}>`;
    }
    return res;
}
// __UNSAFE__
// Reason: eval.
// It's technically safe to eval because only constant expressions are possible
// here, e.g. `{{ 1 }}` or `{{ 'foo' }}`
// in addition, constant exps bail on presence of parens so you can't even
// run JSFuck in here. But we mark it unsafe for security review purposes.
// (see compiler-core/src/transformExpressions)
function evaluateConstant(exp) {
    if (exp.type === 4 /* SIMPLE_EXPRESSION */) {
        return new Function(`return ${exp.content}`)();
    }
    else {
        // compound
        let res = ``;
        exp.children.forEach(c => {
            if (isString(c) || isSymbol(c)) {
                return;
            }
            if (c.type === 2 /* TEXT */) {
                res += c.content;
            }
            else if (c.type === 5 /* INTERPOLATION */) {
                res += toDisplayString(evaluateConstant(c.content));
            }
            else {
                res += evaluateConstant(c);
            }
        });
        return res;
    }
}

const ignoreSideEffectTags = (node, context) => {
    if (node.type === 1 /* ELEMENT */ &&
        node.tagType === 0 /* ELEMENT */ &&
        (node.tag === 'script' || node.tag === 'style')) {
        context.onError(createDOMCompilerError(59 /* X_IGNORED_SIDE_EFFECT_TAG */, node.loc));
        context.removeNode();
    }
};

const DOMNodeTransforms = [
    transformStyle,
    ...( [warnTransitionChildren] )
];
const DOMDirectiveTransforms = {
    cloak: noopDirectiveTransform,
    html: transformVHtml,
    text: transformVText,
    model: transformModel$1,
    on: transformOn$1,
    show: transformShow
};
function compile(template, options = {}) {
    return baseCompile(template, extend({}, parserOptions, options, {
        nodeTransforms: [
            // ignore <script> and <tag>
            // this is not put inside DOMNodeTransforms because that list is used
            // by compiler-ssr to generate vnode fallback branches
            ignoreSideEffectTags,
            ...DOMNodeTransforms,
            ...(options.nodeTransforms || [])
        ],
        directiveTransforms: extend({}, DOMDirectiveTransforms, options.directiveTransforms || {}),
        transformHoist:  stringifyStatic
    }));
}
function parse(template, options = {}) {
    return baseParse(template, extend({}, parserOptions, options));
}

var CompilerDOM = /*#__PURE__*/Object.freeze({
  __proto__: null,
  parserOptions: parserOptions,
  DOMNodeTransforms: DOMNodeTransforms,
  DOMDirectiveTransforms: DOMDirectiveTransforms,
  compile: compile,
  parse: parse,
  transformStyle: transformStyle,
  createDOMCompilerError: createDOMCompilerError,
  V_MODEL_RADIO: V_MODEL_RADIO,
  V_MODEL_CHECKBOX: V_MODEL_CHECKBOX,
  V_MODEL_TEXT: V_MODEL_TEXT,
  V_MODEL_SELECT: V_MODEL_SELECT,
  V_MODEL_DYNAMIC: V_MODEL_DYNAMIC,
  V_ON_WITH_MODIFIERS: V_ON_WITH_MODIFIERS,
  V_ON_WITH_KEYS: V_ON_WITH_KEYS,
  V_SHOW: V_SHOW,
  TRANSITION: TRANSITION,
  TRANSITION_GROUP: TRANSITION_GROUP,
  baseCompile: baseCompile,
  baseParse: baseParse,
  transform: transform,
  createTransformContext: createTransformContext,
  traverseNode: traverseNode,
  createStructuralDirectiveTransform: createStructuralDirectiveTransform,
  generate: generate,
  createCompilerError: createCompilerError,
  getBaseTransformPreset: getBaseTransformPreset,
  transformModel: transformModel,
  transformOn: transformOn,
  transformBind: transformBind,
  noopDirectiveTransform: noopDirectiveTransform,
  processIf: processIf,
  processFor: processFor,
  createForLoopParams: createForLoopParams,
  transformExpression: transformExpression,
  processExpression: processExpression,
  buildSlots: buildSlots,
  trackVForSlotScopes: trackVForSlotScopes,
  trackSlotScopes: trackSlotScopes,
  transformElement: transformElement,
  resolveComponentType: resolveComponentType,
  buildProps: buildProps,
  processSlotOutlet: processSlotOutlet,
  generateCodeFrame: generateCodeFrame,
  locStub: locStub,
  createRoot: createRoot,
  createVNodeCall: createVNodeCall,
  createArrayExpression: createArrayExpression,
  createObjectExpression: createObjectExpression,
  createObjectProperty: createObjectProperty,
  createSimpleExpression: createSimpleExpression,
  createInterpolation: createInterpolation,
  createCompoundExpression: createCompoundExpression,
  createCallExpression: createCallExpression,
  createFunctionExpression: createFunctionExpression,
  createConditionalExpression: createConditionalExpression,
  createCacheExpression: createCacheExpression,
  createBlockStatement: createBlockStatement,
  createTemplateLiteral: createTemplateLiteral,
  createIfStatement: createIfStatement,
  createAssignmentExpression: createAssignmentExpression,
  createSequenceExpression: createSequenceExpression,
  createReturnStatement: createReturnStatement,
  isStaticExp: isStaticExp,
  isBuiltInType: isBuiltInType,
  isCoreComponent: isCoreComponent,
  isSimpleIdentifier: isSimpleIdentifier,
  isMemberExpression: isMemberExpression,
  getInnerRange: getInnerRange,
  advancePositionWithClone: advancePositionWithClone,
  advancePositionWithMutation: advancePositionWithMutation,
  assert: assert,
  findDir: findDir,
  findProp: findProp,
  isBindKey: isBindKey,
  hasDynamicKeyVBind: hasDynamicKeyVBind,
  isText: isText,
  isVSlot: isVSlot,
  isTemplateNode: isTemplateNode,
  isSlotOutlet: isSlotOutlet,
  injectProp: injectProp,
  toValidAssetId: toValidAssetId,
  hasScopeRef: hasScopeRef,
  FRAGMENT: FRAGMENT,
  TELEPORT: TELEPORT,
  SUSPENSE: SUSPENSE,
  KEEP_ALIVE: KEEP_ALIVE,
  BASE_TRANSITION: BASE_TRANSITION,
  OPEN_BLOCK: OPEN_BLOCK,
  CREATE_BLOCK: CREATE_BLOCK,
  CREATE_VNODE: CREATE_VNODE,
  CREATE_COMMENT: CREATE_COMMENT,
  CREATE_TEXT: CREATE_TEXT,
  CREATE_STATIC: CREATE_STATIC,
  RESOLVE_COMPONENT: RESOLVE_COMPONENT,
  RESOLVE_DYNAMIC_COMPONENT: RESOLVE_DYNAMIC_COMPONENT,
  RESOLVE_DIRECTIVE: RESOLVE_DIRECTIVE,
  WITH_DIRECTIVES: WITH_DIRECTIVES,
  RENDER_LIST: RENDER_LIST,
  RENDER_SLOT: RENDER_SLOT,
  CREATE_SLOTS: CREATE_SLOTS,
  TO_DISPLAY_STRING: TO_DISPLAY_STRING,
  MERGE_PROPS: MERGE_PROPS,
  TO_HANDLERS: TO_HANDLERS,
  CAMELIZE: CAMELIZE,
  CAPITALIZE: CAPITALIZE,
  TO_HANDLER_KEY: TO_HANDLER_KEY,
  SET_BLOCK_TRACKING: SET_BLOCK_TRACKING,
  PUSH_SCOPE_ID: PUSH_SCOPE_ID,
  POP_SCOPE_ID: POP_SCOPE_ID,
  WITH_SCOPE_ID: WITH_SCOPE_ID,
  WITH_CTX: WITH_CTX,
  UNREF: UNREF,
  IS_REF: IS_REF,
  helperNameMap: helperNameMap,
  registerRuntimeHelpers: registerRuntimeHelpers
});

const CSS_VARS_HELPER = `useCssVars`;
const cssVarRE = /\bv-bind\(\s*(?:'([^']+)'|"([^"]+)"|([^'"][^)]*))\s*\)/g;
function genCssVarsFromList(vars, id, isProd) {
    return `{\n  ${vars
        .map(key => `"${genVarName(id, key, isProd)}": (${key})`)
        .join(',\n  ')}\n}`;
}
function genVarName(id, raw, isProd) {
    if (isProd) {
        return hash__default(id + raw);
    }
    else {
        return `${id}-${raw.replace(/([^\w-])/g, '_')}`;
    }
}
function parseCssVars(sfc) {
    const vars = [];
    sfc.styles.forEach(style => {
        let match;
        while ((match = cssVarRE.exec(style.content))) {
            vars.push(match[1] || match[2] || match[3]);
        }
    });
    return vars;
}
const cssVarsPlugin = postcss__default.plugin('vue-scoped', opts => (root) => {
    const { id, isProd } = opts;
    root.walkDecls(decl => {
        // rewrite CSS variables
        if (cssVarRE.test(decl.value)) {
            decl.value = decl.value.replace(cssVarRE, (_, $1, $2, $3) => {
                return `var(--${genVarName(id, $1 || $2 || $3, isProd)})`;
            });
        }
    });
});
function genCssVarsCode(vars, bindings, id, isProd) {
    const varsExp = genCssVarsFromList(vars, id, isProd);
    const exp = createSimpleExpression(varsExp, false);
    const context = createTransformContext(createRoot([]), {
        prefixIdentifiers: true,
        inline: true,
        bindingMetadata: bindings
    });
    const transformed = processExpression(exp, context);
    const transformedString = transformed.type === 4 /* SIMPLE_EXPRESSION */
        ? transformed.content
        : transformed.children
            .map(c => {
            return typeof c === 'string'
                ? c
                : c.content;
        })
            .join('');
    return `_${CSS_VARS_HELPER}(_ctx => (${transformedString}))`;
}
// <script setup> already gets the calls injected as part of the transform
// this is only for single normal <script>
function genNormalScriptCssVarsCode(cssVars, bindings, id, isProd) {
    return (`\nimport { ${CSS_VARS_HELPER} as _${CSS_VARS_HELPER} } from 'vue'\n` +
        `const __injectCSSVars__ = () => {\n${genCssVarsCode(cssVars, bindings, id, isProd)}}\n` +
        `const __setup__ = __default__.setup\n` +
        `__default__.setup = __setup__\n` +
        `  ? (props, ctx) => { __injectCSSVars__();return __setup__(props, ctx) }\n` +
        `  : __injectCSSVars__\n`);
}

const hasWarned = {};
function warnOnce(msg) {
    const isNodeProd = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
    if (!isNodeProd && !false && !hasWarned[msg]) {
        hasWarned[msg] = true;
        warn(msg);
    }
}
function warn(msg) {
    console.warn(`\x1b[1m\x1b[33m[@vue/compiler-sfc]\x1b[0m\x1b[33m ${msg}\x1b[0m\n`);
}
function warnExperimental(feature, rfcId) {
    warnOnce(`${feature} is still an experimental proposal.\n` +
        `Follow its status at https://github.com/vuejs/rfcs/pull/${rfcId}.`);
    warnOnce(`When using experimental features,\n` +
        `it is recommended to pin your vue dependencies to exact versions to avoid breakage.`);
}

const SFC_CACHE_MAX_SIZE = 500;
const sourceToSFC =  new (require('lru-cache'))(SFC_CACHE_MAX_SIZE);
function parse$1(source, { sourceMap = true, filename = 'anonymous.vue', sourceRoot = '', pad = false, compiler = CompilerDOM } = {}) {
    const sourceKey = source + sourceMap + filename + sourceRoot + pad + compiler.parse;
    const cache = sourceToSFC.get(sourceKey);
    if (cache) {
        return cache;
    }
    const descriptor = {
        filename,
        source,
        template: null,
        script: null,
        scriptSetup: null,
        styles: [],
        customBlocks: [],
        cssVars: []
    };
    const errors = [];
    const ast = compiler.parse(source, {
        // there are no components at SFC parsing level
        isNativeTag: () => true,
        // preserve all whitespaces
        isPreTag: () => true,
        getTextMode: ({ tag, props }, parent) => {
            // all top level elements except <template> are parsed as raw text
            // containers
            if ((!parent && tag !== 'template') ||
                // <template lang="xxx"> should also be treated as raw text
                (tag === 'template' &&
                    props.some(p => p.type === 6 /* ATTRIBUTE */ &&
                        p.name === 'lang' &&
                        p.value &&
                        p.value.content !== 'html'))) {
                return 2 /* RAWTEXT */;
            }
            else {
                return 0 /* DATA */;
            }
        },
        onError: e => {
            errors.push(e);
        }
    });
    ast.children.forEach(node => {
        if (node.type !== 1 /* ELEMENT */) {
            return;
        }
        if (!node.children.length && !hasSrc(node) && node.tag !== 'template') {
            return;
        }
        switch (node.tag) {
            case 'template':
                if (!descriptor.template) {
                    const templateBlock = (descriptor.template = createBlock(node, source, false));
                    templateBlock.ast = node;
                }
                else {
                    errors.push(createDuplicateBlockError(node));
                }
                break;
            case 'script':
                const scriptBlock = createBlock(node, source, pad);
                const isSetup = !!scriptBlock.attrs.setup;
                if (isSetup && !descriptor.scriptSetup) {
                    descriptor.scriptSetup = scriptBlock;
                    break;
                }
                if (!isSetup && !descriptor.script) {
                    descriptor.script = scriptBlock;
                    break;
                }
                errors.push(createDuplicateBlockError(node, isSetup));
                break;
            case 'style':
                const styleBlock = createBlock(node, source, pad);
                if (styleBlock.attrs.vars) {
                    errors.push(new SyntaxError(`<style vars> has been replaced by a new proposal: ` +
                        `https://github.com/vuejs/rfcs/pull/231`));
                }
                descriptor.styles.push(styleBlock);
                break;
            default:
                descriptor.customBlocks.push(createBlock(node, source, pad));
                break;
        }
    });
    if (descriptor.scriptSetup) {
        if (descriptor.scriptSetup.src) {
            errors.push(new SyntaxError(`<script setup> cannot use the "src" attribute because ` +
                `its syntax will be ambiguous outside of the component.`));
            descriptor.scriptSetup = null;
        }
        if (descriptor.script && descriptor.script.src) {
            errors.push(new SyntaxError(`<script> cannot use the "src" attribute when <script setup> is ` +
                `also present because they must be processed together.`));
            descriptor.script = null;
        }
    }
    if (sourceMap) {
        const genMap = (block) => {
            if (block && !block.src) {
                block.map = generateSourceMap(filename, source, block.content, sourceRoot, !pad || block.type === 'template' ? block.loc.start.line - 1 : 0);
            }
        };
        genMap(descriptor.template);
        genMap(descriptor.script);
        descriptor.styles.forEach(genMap);
        descriptor.customBlocks.forEach(genMap);
    }
    // parse CSS vars
    descriptor.cssVars = parseCssVars(descriptor);
    if (descriptor.cssVars.length) {
        warnExperimental(`v-bind() CSS variable injection`, 231);
    }
    const result = {
        descriptor,
        errors
    };
    sourceToSFC.set(sourceKey, result);
    return result;
}
function createDuplicateBlockError(node, isScriptSetup = false) {
    const err = new SyntaxError(`Single file component can contain only one <${node.tag}${isScriptSetup ? ` setup` : ``}> element`);
    err.loc = node.loc;
    return err;
}
function createBlock(node, source, pad) {
    const type = node.tag;
    let { start, end } = node.loc;
    let content = '';
    if (node.children.length) {
        start = node.children[0].loc.start;
        end = node.children[node.children.length - 1].loc.end;
        content = source.slice(start.offset, end.offset);
    }
    const loc = {
        source: content,
        start,
        end
    };
    const attrs = {};
    const block = {
        type,
        content,
        loc,
        attrs
    };
    if (pad) {
        block.content = padContent(source, block, pad) + block.content;
    }
    node.props.forEach(p => {
        if (p.type === 6 /* ATTRIBUTE */) {
            attrs[p.name] = p.value ? p.value.content || true : true;
            if (p.name === 'lang') {
                block.lang = p.value && p.value.content;
            }
            else if (p.name === 'src') {
                block.src = p.value && p.value.content;
            }
            else if (type === 'style') {
                if (p.name === 'scoped') {
                    block.scoped = true;
                }
                else if (p.name === 'module') {
                    block.module = attrs[p.name];
                }
            }
            else if (type === 'script' && p.name === 'setup') {
                block.setup = attrs.setup;
            }
        }
    });
    return block;
}
const splitRE = /\r?\n/g;
const emptyRE = /^(?:\/\/)?\s*$/;
const replaceRE = /./g;
function generateSourceMap(filename, source, generated, sourceRoot, lineOffset) {
    const map = new sourceMap.SourceMapGenerator({
        file: filename.replace(/\\/g, '/'),
        sourceRoot: sourceRoot.replace(/\\/g, '/')
    });
    map.setSourceContent(filename, source);
    generated.split(splitRE).forEach((line, index) => {
        if (!emptyRE.test(line)) {
            const originalLine = index + 1 + lineOffset;
            const generatedLine = index + 1;
            for (let i = 0; i < line.length; i++) {
                if (!/\s/.test(line[i])) {
                    map.addMapping({
                        source: filename,
                        original: {
                            line: originalLine,
                            column: i
                        },
                        generated: {
                            line: generatedLine,
                            column: i
                        }
                    });
                }
            }
        }
    });
    return JSON.parse(map.toString());
}
function padContent(content, block, pad) {
    content = content.slice(0, block.loc.start.offset);
    if (pad === 'space') {
        return content.replace(replaceRE, ' ');
    }
    else {
        const offset = content.split(splitRE).length;
        const padChar = block.type === 'script' && !block.lang ? '//\n' : '\n';
        return Array(offset).join(padChar);
    }
}
function hasSrc(node) {
    return node.props.some(p => {
        if (p.type !== 6 /* ATTRIBUTE */) {
            return false;
        }
        return p.name === 'src';
    });
}

function isRelativeUrl(url) {
    const firstChar = url.charAt(0);
    return firstChar === '.' || firstChar === '~' || firstChar === '@';
}
const externalRE = /^https?:\/\//;
function isExternalUrl(url) {
    return externalRE.test(url);
}
const dataUrlRE = /^\s*data:/i;
function isDataUrl(url) {
    return dataUrlRE.test(url);
}
/**
 * Parses string url into URL object.
 */
function parseUrl(url) {
    const firstChar = url.charAt(0);
    if (firstChar === '~') {
        const secondChar = url.charAt(1);
        url = url.slice(secondChar === '/' ? 2 : 1);
    }
    return parseUriParts(url);
}
/**
 * vuejs/component-compiler-utils#22 Support uri fragment in transformed require
 * @param urlString an url as a string
 */
function parseUriParts(urlString) {
    // A TypeError is thrown if urlString is not a string
    // @see https://nodejs.org/api/url.html#url_url_parse_urlstring_parsequerystring_slashesdenotehost
    return url.parse(isString(urlString) ? urlString : '', false, true);
}

const defaultAssetUrlOptions = {
    base: null,
    includeAbsolute: false,
    tags: {
        video: ['src', 'poster'],
        source: ['src'],
        img: ['src'],
        image: ['xlink:href', 'href'],
        use: ['xlink:href', 'href']
    }
};
const normalizeOptions = (options) => {
    if (Object.keys(options).some(key => isArray(options[key]))) {
        // legacy option format which directly passes in tags config
        return {
            ...defaultAssetUrlOptions,
            tags: options
        };
    }
    return {
        ...defaultAssetUrlOptions,
        ...options
    };
};
const createAssetUrlTransformWithOptions = (options) => {
    return (node, context) => transformAssetUrl(node, context, options);
};
/**
 * A `@vue/compiler-core` plugin that transforms relative asset urls into
 * either imports or absolute urls.
 *
 * ``` js
 * // Before
 * createVNode('img', { src: './logo.png' })
 *
 * // After
 * import _imports_0 from './logo.png'
 * createVNode('img', { src: _imports_0 })
 * ```
 */
const transformAssetUrl = (node, context, options = defaultAssetUrlOptions) => {
    if (node.type === 1 /* ELEMENT */) {
        if (!node.props.length) {
            return;
        }
        const tags = options.tags || defaultAssetUrlOptions.tags;
        const attrs = tags[node.tag];
        const wildCardAttrs = tags['*'];
        if (!attrs && !wildCardAttrs) {
            return;
        }
        const assetAttrs = (attrs || []).concat(wildCardAttrs || []);
        node.props.forEach((attr, index) => {
            if (attr.type !== 6 /* ATTRIBUTE */ ||
                !assetAttrs.includes(attr.name) ||
                !attr.value ||
                isExternalUrl(attr.value.content) ||
                isDataUrl(attr.value.content) ||
                attr.value.content[0] === '#' ||
                (!options.includeAbsolute && !isRelativeUrl(attr.value.content))) {
                return;
            }
            const url = parseUrl(attr.value.content);
            if (options.base && attr.value.content[0] === '.') {
                // explicit base - directly rewrite relative urls into absolute url
                // to avoid generating extra imports
                // Allow for full hostnames provided in options.base
                const base = parseUrl(options.base);
                const protocol = base.protocol || '';
                const host = base.host ? protocol + '//' + base.host : '';
                const basePath = base.path || '/';
                // when packaged in the browser, path will be using the posix-
                // only version provided by rollup-plugin-node-builtins.
                attr.value.content =
                    host +
                        (path__default.posix || path__default).join(basePath, url.path + (url.hash || ''));
                return;
            }
            // otherwise, transform the url into an import.
            // this assumes a bundler will resolve the import into the correct
            // absolute url (e.g. webpack file-loader)
            const exp = getImportsExpressionExp(url.path, url.hash, attr.loc, context);
            node.props[index] = {
                type: 7 /* DIRECTIVE */,
                name: 'bind',
                arg: createSimpleExpression(attr.name, true, attr.loc),
                exp,
                modifiers: [],
                loc: attr.loc
            };
        });
    }
};
function getImportsExpressionExp(path, hash, loc, context) {
    if (path) {
        const importsArray = Array.from(context.imports);
        const existing = importsArray.find(i => i.path === path);
        if (existing) {
            return existing.exp;
        }
        const name = `_imports_${importsArray.length}`;
        const exp = createSimpleExpression(name, false, loc, 2 /* CAN_HOIST */);
        context.imports.add({ exp, path });
        if (hash && path) {
            return context.hoist(createSimpleExpression(`${name} + '${hash}'`, false, loc, 2 /* CAN_HOIST */));
        }
        else {
            return exp;
        }
    }
    else {
        return createSimpleExpression(`''`, false, loc, 2 /* CAN_HOIST */);
    }
}

const srcsetTags = ['img', 'source'];
// http://w3c.github.io/html/semantics-embedded-content.html#ref-for-image-candidate-string-5
const escapedSpaceCharacters = /( |\\t|\\n|\\f|\\r)+/g;
const createSrcsetTransformWithOptions = (options) => {
    return (node, context) => transformSrcset(node, context, options);
};
const transformSrcset = (node, context, options = defaultAssetUrlOptions) => {
    if (node.type === 1 /* ELEMENT */) {
        if (srcsetTags.includes(node.tag) && node.props.length) {
            node.props.forEach((attr, index) => {
                if (attr.name === 'srcset' && attr.type === 6 /* ATTRIBUTE */) {
                    if (!attr.value)
                        return;
                    const value = attr.value.content;
                    const imageCandidates = value.split(',').map(s => {
                        // The attribute value arrives here with all whitespace, except
                        // normal spaces, represented by escape sequences
                        const [url, descriptor] = s
                            .replace(escapedSpaceCharacters, ' ')
                            .trim()
                            .split(' ', 2);
                        return { url, descriptor };
                    });
                    // for data url need recheck url
                    for (let i = 0; i < imageCandidates.length; i++) {
                        if (imageCandidates[i].url.trim().startsWith('data:')) {
                            imageCandidates[i + 1].url =
                                imageCandidates[i].url + ',' + imageCandidates[i + 1].url;
                            imageCandidates.splice(i, 1);
                        }
                    }
                    // When srcset does not contain any relative URLs, skip transforming
                    if (!options.includeAbsolute &&
                        !imageCandidates.some(({ url }) => isRelativeUrl(url))) {
                        return;
                    }
                    if (options.base) {
                        const base = options.base;
                        const set = [];
                        imageCandidates.forEach(({ url, descriptor }) => {
                            descriptor = descriptor ? ` ${descriptor}` : ``;
                            if (isRelativeUrl(url)) {
                                set.push((path__default.posix || path__default).join(base, url) + descriptor);
                            }
                            else {
                                set.push(url + descriptor);
                            }
                        });
                        attr.value.content = set.join(', ');
                        return;
                    }
                    const compoundExpression = createCompoundExpression([], attr.loc);
                    imageCandidates.forEach(({ url, descriptor }, index) => {
                        if (!isExternalUrl(url) &&
                            !isDataUrl(url) &&
                            (options.includeAbsolute || isRelativeUrl(url))) {
                            const { path } = parseUrl(url);
                            let exp;
                            if (path) {
                                const importsArray = Array.from(context.imports);
                                const existingImportsIndex = importsArray.findIndex(i => i.path === path);
                                if (existingImportsIndex > -1) {
                                    exp = createSimpleExpression(`_imports_${existingImportsIndex}`, false, attr.loc, 2 /* CAN_HOIST */);
                                }
                                else {
                                    exp = createSimpleExpression(`_imports_${importsArray.length}`, false, attr.loc, 2 /* CAN_HOIST */);
                                    context.imports.add({ exp, path });
                                }
                                compoundExpression.children.push(exp);
                            }
                        }
                        else {
                            const exp = createSimpleExpression(`"${url}"`, false, attr.loc, 2 /* CAN_HOIST */);
                            compoundExpression.children.push(exp);
                        }
                        const isNotLast = imageCandidates.length - 1 > index;
                        if (descriptor && isNotLast) {
                            compoundExpression.children.push(` + '${descriptor}, ' + `);
                        }
                        else if (descriptor) {
                            compoundExpression.children.push(` + '${descriptor}'`);
                        }
                        else if (isNotLast) {
                            compoundExpression.children.push(` + ', ' + `);
                        }
                    });
                    const hoisted = context.hoist(compoundExpression);
                    hoisted.constType = 2 /* CAN_HOIST */;
                    node.props[index] = {
                        type: 7 /* DIRECTIVE */,
                        name: 'bind',
                        arg: createSimpleExpression('srcset', true, attr.loc),
                        exp: hoisted,
                        modifiers: [],
                        loc: attr.loc
                    };
                }
            });
        }
    }
};

const SSR_INTERPOLATE = Symbol(`ssrInterpolate`);
const SSR_RENDER_VNODE = Symbol(`ssrRenderVNode`);
const SSR_RENDER_COMPONENT = Symbol(`ssrRenderComponent`);
const SSR_RENDER_SLOT = Symbol(`ssrRenderSlot`);
const SSR_RENDER_CLASS = Symbol(`ssrRenderClass`);
const SSR_RENDER_STYLE = Symbol(`ssrRenderStyle`);
const SSR_RENDER_ATTRS = Symbol(`ssrRenderAttrs`);
const SSR_RENDER_ATTR = Symbol(`ssrRenderAttr`);
const SSR_RENDER_DYNAMIC_ATTR = Symbol(`ssrRenderDynamicAttr`);
const SSR_RENDER_LIST = Symbol(`ssrRenderList`);
const SSR_LOOSE_EQUAL = Symbol(`ssrLooseEqual`);
const SSR_LOOSE_CONTAIN = Symbol(`ssrLooseContain`);
const SSR_RENDER_DYNAMIC_MODEL = Symbol(`ssrRenderDynamicModel`);
const SSR_GET_DYNAMIC_MODEL_PROPS = Symbol(`ssrGetDynamicModelProps`);
const SSR_RENDER_TELEPORT = Symbol(`ssrRenderTeleport`);
const SSR_RENDER_SUSPENSE = Symbol(`ssrRenderSuspense`);
const ssrHelpers = {
    [SSR_INTERPOLATE]: `ssrInterpolate`,
    [SSR_RENDER_VNODE]: `ssrRenderVNode`,
    [SSR_RENDER_COMPONENT]: `ssrRenderComponent`,
    [SSR_RENDER_SLOT]: `ssrRenderSlot`,
    [SSR_RENDER_CLASS]: `ssrRenderClass`,
    [SSR_RENDER_STYLE]: `ssrRenderStyle`,
    [SSR_RENDER_ATTRS]: `ssrRenderAttrs`,
    [SSR_RENDER_ATTR]: `ssrRenderAttr`,
    [SSR_RENDER_DYNAMIC_ATTR]: `ssrRenderDynamicAttr`,
    [SSR_RENDER_LIST]: `ssrRenderList`,
    [SSR_LOOSE_EQUAL]: `ssrLooseEqual`,
    [SSR_LOOSE_CONTAIN]: `ssrLooseContain`,
    [SSR_RENDER_DYNAMIC_MODEL]: `ssrRenderDynamicModel`,
    [SSR_GET_DYNAMIC_MODEL_PROPS]: `ssrGetDynamicModelProps`,
    [SSR_RENDER_TELEPORT]: `ssrRenderTeleport`,
    [SSR_RENDER_SUSPENSE]: `ssrRenderSuspense`
};
// Note: these are helpers imported from @vue/server-renderer
// make sure the names match!
registerRuntimeHelpers(ssrHelpers);

// Plugin for the first transform pass, which simply constructs the AST node
const ssrTransformIf = createStructuralDirectiveTransform(/^(if|else|else-if)$/, processIf);
// This is called during the 2nd transform pass to construct the SSR-specific
// codegen nodes.
function ssrProcessIf(node, context, disableNestedFragments = false) {
    const [rootBranch] = node.branches;
    const ifStatement = createIfStatement(rootBranch.condition, processIfBranch(rootBranch, context, disableNestedFragments));
    context.pushStatement(ifStatement);
    let currentIf = ifStatement;
    for (let i = 1; i < node.branches.length; i++) {
        const branch = node.branches[i];
        const branchBlockStatement = processIfBranch(branch, context, disableNestedFragments);
        if (branch.condition) {
            // else-if
            currentIf = currentIf.alternate = createIfStatement(branch.condition, branchBlockStatement);
        }
        else {
            // else
            currentIf.alternate = branchBlockStatement;
        }
    }
    if (!currentIf.alternate) {
        currentIf.alternate = createBlockStatement([
            createCallExpression(`_push`, ['`<!---->`'])
        ]);
    }
}
function processIfBranch(branch, context, disableNestedFragments = false) {
    const { children } = branch;
    const needFragmentWrapper = !disableNestedFragments &&
        (children.length !== 1 || children[0].type !== 1 /* ELEMENT */) &&
        // optimize away nested fragments when the only child is a ForNode
        !(children.length === 1 && children[0].type === 11 /* FOR */);
    return processChildrenAsStatement(children, context, needFragmentWrapper);
}

// Plugin for the first transform pass, which simply constructs the AST node
const ssrTransformFor = createStructuralDirectiveTransform('for', processFor);
// This is called during the 2nd transform pass to construct the SSR-specific
// codegen nodes.
function ssrProcessFor(node, context, disableNestedFragments = false) {
    const needFragmentWrapper = !disableNestedFragments &&
        (node.children.length !== 1 || node.children[0].type !== 1 /* ELEMENT */);
    const renderLoop = createFunctionExpression(createForLoopParams(node.parseResult));
    renderLoop.body = processChildrenAsStatement(node.children, context, needFragmentWrapper);
    // v-for always renders a fragment unless explicitly disabled
    if (!disableNestedFragments) {
        context.pushStringPart(`<!--[-->`);
    }
    context.pushStatement(createCallExpression(context.helper(SSR_RENDER_LIST), [
        node.source,
        renderLoop
    ]));
    if (!disableNestedFragments) {
        context.pushStringPart(`<!--]-->`);
    }
}

const ssrTransformSlotOutlet = (node, context) => {
    if (isSlotOutlet(node)) {
        const { slotName, slotProps } = processSlotOutlet(node, context);
        node.ssrCodegenNode = createCallExpression(context.helper(SSR_RENDER_SLOT), [
            `_ctx.$slots`,
            slotName,
            slotProps || `{}`,
            `null`,
            `_push`,
            `_parent`
        ]);
    }
};
function ssrProcessSlotOutlet(node, context) {
    const renderCall = node.ssrCodegenNode;
    // has fallback content
    if (node.children.length) {
        const fallbackRenderFn = createFunctionExpression([]);
        fallbackRenderFn.body = processChildrenAsStatement(node.children, context);
        // _renderSlot(slots, name, props, fallback, ...)
        renderCall.arguments[3] = fallbackRenderFn;
    }
    context.pushStatement(node.ssrCodegenNode);
}

function createSSRCompilerError(code, loc) {
    return createCompilerError(code, loc, SSRErrorMessages);
}
const SSRErrorMessages = {
    [60 /* X_SSR_CUSTOM_DIRECTIVE_NO_TRANSFORM */]: `Custom directive is missing corresponding SSR transform and will be ignored.`,
    [61 /* X_SSR_UNSAFE_ATTR_NAME */]: `Unsafe attribute name for SSR.`,
    [62 /* X_SSR_NO_TELEPORT_TARGET */]: `Missing the 'to' prop on teleport element.`,
    [63 /* X_SSR_INVALID_AST_NODE */]: `Invalid AST node during SSR transform.`
};

// Note: this is a 2nd-pass codegen transform.
function ssrProcessTeleport(node, context) {
    const targetProp = findProp(node, 'to');
    if (!targetProp) {
        context.onError(createSSRCompilerError(62 /* X_SSR_NO_TELEPORT_TARGET */, node.loc));
        return;
    }
    let target;
    if (targetProp.type === 6 /* ATTRIBUTE */) {
        target =
            targetProp.value && createSimpleExpression(targetProp.value.content, true);
    }
    else {
        target = targetProp.exp;
    }
    if (!target) {
        context.onError(createSSRCompilerError(62 /* X_SSR_NO_TELEPORT_TARGET */, targetProp.loc));
        return;
    }
    const disabledProp = findProp(node, 'disabled', false, true /* allow empty */);
    const disabled = disabledProp
        ? disabledProp.type === 6 /* ATTRIBUTE */
            ? `true`
            : disabledProp.exp || `false`
        : `false`;
    const contentRenderFn = createFunctionExpression([`_push`], undefined, // Body is added later
    true, // newline
    false, // isSlot
    node.loc);
    contentRenderFn.body = processChildrenAsStatement(node.children, context);
    context.pushStatement(createCallExpression(context.helper(SSR_RENDER_TELEPORT), [
        `_push`,
        contentRenderFn,
        target,
        disabled,
        `_parent`
    ]));
}

const wipMap = new WeakMap();
// phase 1
function ssrTransformSuspense(node, context) {
    return () => {
        if (node.children.length) {
            const wipEntry = {
                slotsExp: null,
                wipSlots: []
            };
            wipMap.set(node, wipEntry);
            wipEntry.slotsExp = buildSlots(node, context, (_props, children, loc) => {
                const fn = createFunctionExpression([], undefined, // no return, assign body later
                true, // newline
                false, // suspense slots are not treated as normal slots
                loc);
                wipEntry.wipSlots.push({
                    fn,
                    children
                });
                return fn;
            }).slots;
        }
    };
}
// phase 2
function ssrProcessSuspense(node, context) {
    // complete wip slots with ssr code
    const wipEntry = wipMap.get(node);
    if (!wipEntry) {
        return;
    }
    const { slotsExp, wipSlots } = wipEntry;
    for (let i = 0; i < wipSlots.length; i++) {
        const { fn, children } = wipSlots[i];
        fn.body = processChildrenAsStatement(children, context);
    }
    // _push(ssrRenderSuspense(slots))
    context.pushStatement(createCallExpression(context.helper(SSR_RENDER_SUSPENSE), [
        `_push`,
        slotsExp
    ]));
}

function ssrProcessTransitionGroup(node, context) {
    const tag = findProp(node, 'tag');
    if (tag) {
        if (tag.type === 7 /* DIRECTIVE */) {
            // dynamic :tag
            context.pushStringPart(`<`);
            context.pushStringPart(tag.exp);
            context.pushStringPart(`>`);
            processChildren(node.children, context, false, 
            /**
             * TransitionGroup has the special runtime behavior of flattening and
             * concatenating all children into a single fragment (in order for them to
             * be pathced using the same key map) so we need to account for that here
             * by disabling nested fragment wrappers from being generated.
             */
            true);
            context.pushStringPart(`</`);
            context.pushStringPart(tag.exp);
            context.pushStringPart(`>`);
        }
        else {
            // static tag
            context.pushStringPart(`<${tag.value.content}>`);
            processChildren(node.children, context, false, true);
            context.pushStringPart(`</${tag.value.content}>`);
        }
    }
    else {
        // fragment
        processChildren(node.children, context, true, true);
    }
}

// We need to construct the slot functions in the 1st pass to ensure proper
// scope tracking, but the children of each slot cannot be processed until
// the 2nd pass, so we store the WIP slot functions in a weakmap during the 1st
// pass and complete them in the 2nd pass.
const wipMap$1 = new WeakMap();
const componentTypeMap = new WeakMap();
// ssr component transform is done in two phases:
// In phase 1. we use `buildSlot` to analyze the children of the component into
// WIP slot functions (it must be done in phase 1 because `buildSlot` relies on
// the core transform context).
// In phase 2. we convert the WIP slots from phase 1 into ssr-specific codegen
// nodes.
const ssrTransformComponent = (node, context) => {
    if (node.type !== 1 /* ELEMENT */ ||
        node.tagType !== 1 /* COMPONENT */) {
        return;
    }
    const component = resolveComponentType(node, context, true /* ssr */);
    componentTypeMap.set(node, component);
    if (isSymbol(component)) {
        if (component === SUSPENSE) {
            return ssrTransformSuspense(node, context);
        }
        return; // built-in component: fallthrough
    }
    // Build the fallback vnode-based branch for the component's slots.
    // We need to clone the node into a fresh copy and use the buildSlots' logic
    // to get access to the children of each slot. We then compile them with
    // a child transform pipeline using vnode-based transforms (instead of ssr-
    // based ones), and save the result branch (a ReturnStatement) in an array.
    // The branch is retrieved when processing slots again in ssr mode.
    const vnodeBranches = [];
    const clonedNode = clone(node);
    return function ssrPostTransformComponent() {
        // Using the cloned node, build the normal VNode-based branches (for
        // fallback in case the child is render-fn based). Store them in an array
        // for later use.
        if (clonedNode.children.length) {
            buildSlots(clonedNode, context, (props, children) => {
                vnodeBranches.push(createVNodeSlotBranch(props, children, context));
                return createFunctionExpression(undefined);
            });
        }
        const props = node.props.length > 0
            ? // note we are not passing ssr: true here because for components, v-on
                // handlers should still be passed
                buildProps(node, context).props || `null`
            : `null`;
        const wipEntries = [];
        wipMap$1.set(node, wipEntries);
        const buildSSRSlotFn = (props, children, loc) => {
            const fn = createFunctionExpression([props || `_`, `_push`, `_parent`, `_scopeId`], undefined, // no return, assign body later
            true, // newline
            true, // isSlot
            loc);
            wipEntries.push({
                fn,
                children,
                // also collect the corresponding vnode branch built earlier
                vnodeBranch: vnodeBranches[wipEntries.length]
            });
            return fn;
        };
        const slots = node.children.length
            ? buildSlots(node, context, buildSSRSlotFn).slots
            : `null`;
        if (typeof component !== 'string') {
            // dynamic component that resolved to a `resolveDynamicComponent` call
            // expression - since the resolved result may be a plain element (string)
            // or a VNode, handle it with `renderVNode`.
            node.ssrCodegenNode = createCallExpression(context.helper(SSR_RENDER_VNODE), [
                `_push`,
                createCallExpression(context.helper(CREATE_VNODE), [
                    component,
                    props,
                    slots
                ]),
                `_parent`
            ]);
        }
        else {
            node.ssrCodegenNode = createCallExpression(context.helper(SSR_RENDER_COMPONENT), [component, props, slots, `_parent`]);
        }
    };
};
function ssrProcessComponent(node, context) {
    const component = componentTypeMap.get(node);
    if (!node.ssrCodegenNode) {
        // this is a built-in component that fell-through.
        if (component === TELEPORT) {
            return ssrProcessTeleport(node, context);
        }
        else if (component === SUSPENSE) {
            return ssrProcessSuspense(node, context);
        }
        else if (component === TRANSITION_GROUP) {
            return ssrProcessTransitionGroup(node, context);
        }
        else {
            // real fall-through (e.g. KeepAlive): just render its children.
            processChildren(node.children, context);
        }
    }
    else {
        // finish up slot function expressions from the 1st pass.
        const wipEntries = wipMap$1.get(node) || [];
        for (let i = 0; i < wipEntries.length; i++) {
            const { fn, children, vnodeBranch } = wipEntries[i];
            // For each slot, we generate two branches: one SSR-optimized branch and
            // one normal vnode-based branch. The branches are taken based on the
            // presence of the 2nd `_push` argument (which is only present if the slot
            // is called by `_ssrRenderSlot`.
            fn.body = createIfStatement(createSimpleExpression(`_push`, false), processChildrenAsStatement(children, context, false, true /* withSlotScopeId */), vnodeBranch);
        }
        if (typeof component === 'string') {
            // static component
            context.pushStatement(createCallExpression(`_push`, [node.ssrCodegenNode]));
        }
        else {
            // dynamic component (`resolveDynamicComponent` call)
            // the codegen node is a `renderVNode` call
            context.pushStatement(node.ssrCodegenNode);
        }
    }
}
const rawOptionsMap = new WeakMap();
const [baseNodeTransforms, baseDirectiveTransforms] = getBaseTransformPreset(true);
const vnodeNodeTransforms = [...baseNodeTransforms, ...DOMNodeTransforms];
const vnodeDirectiveTransforms = {
    ...baseDirectiveTransforms,
    ...DOMDirectiveTransforms
};
function createVNodeSlotBranch(props, children, parentContext) {
    // apply a sub-transform using vnode-based transforms.
    const rawOptions = rawOptionsMap.get(parentContext.root);
    const subOptions = {
        ...rawOptions,
        // overwrite with vnode-based transforms
        nodeTransforms: [
            ...vnodeNodeTransforms,
            ...(rawOptions.nodeTransforms || [])
        ],
        directiveTransforms: {
            ...vnodeDirectiveTransforms,
            ...(rawOptions.directiveTransforms || {})
        }
    };
    // wrap the children with a wrapper template for proper children treatment.
    const wrapperNode = {
        type: 1 /* ELEMENT */,
        ns: 0 /* HTML */,
        tag: 'template',
        tagType: 3 /* TEMPLATE */,
        isSelfClosing: false,
        // important: provide v-slot="props" on the wrapper for proper
        // scope analysis
        props: [
            {
                type: 7 /* DIRECTIVE */,
                name: 'slot',
                exp: props,
                arg: undefined,
                modifiers: [],
                loc: locStub
            }
        ],
        children,
        loc: locStub,
        codegenNode: undefined
    };
    subTransform(wrapperNode, subOptions, parentContext);
    return createReturnStatement(children);
}
function subTransform(node, options, parentContext) {
    const childRoot = createRoot([node]);
    const childContext = createTransformContext(childRoot, options);
    // this sub transform is for vnode fallback branch so it should be handled
    // like normal render functions
    childContext.ssr = false;
    // inherit parent scope analysis state
    childContext.scopes = { ...parentContext.scopes };
    childContext.identifiers = { ...parentContext.identifiers };
    // traverse
    traverseNode(childRoot, childContext);
    ['helpers', 'components', 'directives', 'imports'].forEach(key => {
        childContext[key].forEach((value) => {
            parentContext[key].add(value);
        });
    });
}
function clone(v) {
    if (isArray(v)) {
        return v.map(clone);
    }
    else if (isObject(v)) {
        const res = {};
        for (const key in v) {
            res[key] = clone(v[key]);
        }
        return res;
    }
    else {
        return v;
    }
}

// for directives with children overwrite (e.g. v-html & v-text), we need to
// store the raw children so that they can be added in the 2nd pass.
const rawChildrenMap = new WeakMap();
const ssrTransformElement = (node, context) => {
    if (node.type !== 1 /* ELEMENT */ ||
        node.tagType !== 0 /* ELEMENT */) {
        return;
    }
    return function ssrPostTransformElement() {
        // element
        // generate the template literal representing the open tag.
        const openTag = [`<${node.tag}`];
        // some tags need to be passed to runtime for special checks
        const needTagForRuntime = node.tag === 'textarea' || node.tag.indexOf('-') > 0;
        // v-bind="obj" or v-bind:[key] can potentially overwrite other static
        // attrs and can affect final rendering result, so when they are present
        // we need to bail out to full `renderAttrs`
        const hasDynamicVBind = hasDynamicKeyVBind(node);
        if (hasDynamicVBind) {
            const { props } = buildProps(node, context, node.props, true /* ssr */);
            if (props) {
                const propsExp = createCallExpression(context.helper(SSR_RENDER_ATTRS), [props]);
                if (node.tag === 'textarea') {
                    const existingText = node.children[0];
                    // If interpolation, this is dynamic <textarea> content, potentially
                    // injected by v-model and takes higher priority than v-bind value
                    if (!existingText || existingText.type !== 5 /* INTERPOLATION */) {
                        // <textarea> with dynamic v-bind. We don't know if the final props
                        // will contain .value, so we will have to do something special:
                        // assign the merged props to a temp variable, and check whether
                        // it contains value (if yes, render is as children).
                        const tempId = `_temp${context.temps++}`;
                        propsExp.arguments = [
                            createAssignmentExpression(createSimpleExpression(tempId, false), props)
                        ];
                        rawChildrenMap.set(node, createCallExpression(context.helper(SSR_INTERPOLATE), [
                            createConditionalExpression(createSimpleExpression(`"value" in ${tempId}`, false), createSimpleExpression(`${tempId}.value`, false), createSimpleExpression(existingText ? existingText.content : ``, true), false)
                        ]));
                    }
                }
                else if (node.tag === 'input') {
                    // <input v-bind="obj" v-model>
                    // we need to determine the props to render for the dynamic v-model
                    // and merge it with the v-bind expression.
                    const vModel = findVModel(node);
                    if (vModel) {
                        // 1. save the props (san v-model) in a temp variable
                        const tempId = `_temp${context.temps++}`;
                        const tempExp = createSimpleExpression(tempId, false);
                        propsExp.arguments = [
                            createSequenceExpression([
                                createAssignmentExpression(tempExp, props),
                                createCallExpression(context.helper(MERGE_PROPS), [
                                    tempExp,
                                    createCallExpression(context.helper(SSR_GET_DYNAMIC_MODEL_PROPS), [
                                        tempExp,
                                        vModel.exp // model
                                    ])
                                ])
                            ])
                        ];
                    }
                }
                if (needTagForRuntime) {
                    propsExp.arguments.push(`"${node.tag}"`);
                }
                openTag.push(propsExp);
            }
        }
        // book keeping static/dynamic class merging.
        let dynamicClassBinding = undefined;
        let staticClassBinding = undefined;
        // all style bindings are converted to dynamic by transformStyle.
        // but we need to make sure to merge them.
        let dynamicStyleBinding = undefined;
        for (let i = 0; i < node.props.length; i++) {
            const prop = node.props[i];
            // ignore true-value/false-value on input
            if (node.tag === 'input' && isTrueFalseValue(prop)) {
                continue;
            }
            // special cases with children override
            if (prop.type === 7 /* DIRECTIVE */) {
                if (prop.name === 'html' && prop.exp) {
                    rawChildrenMap.set(node, prop.exp);
                }
                else if (prop.name === 'text' && prop.exp) {
                    node.children = [createInterpolation(prop.exp, prop.loc)];
                }
                else if (prop.name === 'slot') {
                    context.onError(createCompilerError(39 /* X_V_SLOT_MISPLACED */, prop.loc));
                }
                else if (isTextareaWithValue(node, prop) && prop.exp) {
                    if (!hasDynamicVBind) {
                        node.children = [createInterpolation(prop.exp, prop.loc)];
                    }
                }
                else {
                    // Directive transforms.
                    const directiveTransform = context.directiveTransforms[prop.name];
                    if (!directiveTransform) {
                        // no corresponding ssr directive transform found.
                        context.onError(createSSRCompilerError(60 /* X_SSR_CUSTOM_DIRECTIVE_NO_TRANSFORM */, prop.loc));
                    }
                    else if (!hasDynamicVBind) {
                        const { props, ssrTagParts } = directiveTransform(prop, node, context);
                        if (ssrTagParts) {
                            openTag.push(...ssrTagParts);
                        }
                        for (let j = 0; j < props.length; j++) {
                            const { key, value } = props[j];
                            if (isStaticExp(key)) {
                                let attrName = key.content;
                                // static key attr
                                if (attrName === 'key' || attrName === 'ref') {
                                    continue;
                                }
                                if (attrName === 'class') {
                                    openTag.push(` class="`, (dynamicClassBinding = createCallExpression(context.helper(SSR_RENDER_CLASS), [value])), `"`);
                                }
                                else if (attrName === 'style') {
                                    if (dynamicStyleBinding) {
                                        // already has style binding, merge into it.
                                        mergeCall(dynamicStyleBinding, value);
                                    }
                                    else {
                                        openTag.push(` style="`, (dynamicStyleBinding = createCallExpression(context.helper(SSR_RENDER_STYLE), [value])), `"`);
                                    }
                                }
                                else {
                                    attrName =
                                        node.tag.indexOf('-') > 0
                                            ? attrName // preserve raw name on custom elements
                                            : propsToAttrMap[attrName] || attrName.toLowerCase();
                                    if (isBooleanAttr(attrName)) {
                                        openTag.push(createConditionalExpression(value, createSimpleExpression(' ' + attrName, true), createSimpleExpression('', true), false /* no newline */));
                                    }
                                    else if (isSSRSafeAttrName(attrName)) {
                                        openTag.push(createCallExpression(context.helper(SSR_RENDER_ATTR), [
                                            key,
                                            value
                                        ]));
                                    }
                                    else {
                                        context.onError(createSSRCompilerError(61 /* X_SSR_UNSAFE_ATTR_NAME */, key.loc));
                                    }
                                }
                            }
                            else {
                                // dynamic key attr
                                // this branch is only encountered for custom directive
                                // transforms that returns properties with dynamic keys
                                const args = [key, value];
                                if (needTagForRuntime) {
                                    args.push(`"${node.tag}"`);
                                }
                                openTag.push(createCallExpression(context.helper(SSR_RENDER_DYNAMIC_ATTR), args));
                            }
                        }
                    }
                }
            }
            else {
                // special case: value on <textarea>
                if (node.tag === 'textarea' && prop.name === 'value' && prop.value) {
                    rawChildrenMap.set(node, escapeHtml(prop.value.content));
                }
                else if (!hasDynamicVBind) {
                    if (prop.name === 'key' || prop.name === 'ref') {
                        continue;
                    }
                    // static prop
                    if (prop.name === 'class' && prop.value) {
                        staticClassBinding = JSON.stringify(prop.value.content);
                    }
                    openTag.push(` ${prop.name}` +
                        (prop.value ? `="${escapeHtml(prop.value.content)}"` : ``));
                }
            }
        }
        // handle co-existence of dynamic + static class bindings
        if (dynamicClassBinding && staticClassBinding) {
            mergeCall(dynamicClassBinding, staticClassBinding);
            removeStaticBinding(openTag, 'class');
        }
        if (context.scopeId) {
            openTag.push(` ${context.scopeId}`);
        }
        node.ssrCodegenNode = createTemplateLiteral(openTag);
    };
};
function isTrueFalseValue(prop) {
    if (prop.type === 7 /* DIRECTIVE */) {
        return (prop.name === 'bind' &&
            prop.arg &&
            isStaticExp(prop.arg) &&
            (prop.arg.content === 'true-value' || prop.arg.content === 'false-value'));
    }
    else {
        return prop.name === 'true-value' || prop.name === 'false-value';
    }
}
function isTextareaWithValue(node, prop) {
    return !!(node.tag === 'textarea' &&
        prop.name === 'bind' &&
        isBindKey(prop.arg, 'value'));
}
function mergeCall(call, arg) {
    const existing = call.arguments[0];
    if (existing.type === 17 /* JS_ARRAY_EXPRESSION */) {
        existing.elements.push(arg);
    }
    else {
        call.arguments[0] = createArrayExpression([existing, arg]);
    }
}
function removeStaticBinding(tag, binding) {
    const regExp = new RegExp(`^ ${binding}=".+"$`);
    const i = tag.findIndex(e => typeof e === 'string' && regExp.test(e));
    if (i > -1) {
        tag.splice(i, 1);
    }
}
function findVModel(node) {
    return node.props.find(p => p.type === 7 /* DIRECTIVE */ && p.name === 'model' && p.exp);
}
function ssrProcessElement(node, context) {
    const isVoidTag = context.options.isVoidTag || NO;
    const elementsToAdd = node.ssrCodegenNode.elements;
    for (let j = 0; j < elementsToAdd.length; j++) {
        context.pushStringPart(elementsToAdd[j]);
    }
    // Handle slot scopeId
    if (context.withSlotScopeId) {
        context.pushStringPart(createSimpleExpression(`_scopeId`, false));
    }
    // close open tag
    context.pushStringPart(`>`);
    const rawChildren = rawChildrenMap.get(node);
    if (rawChildren) {
        context.pushStringPart(rawChildren);
    }
    else if (node.children.length) {
        processChildren(node.children, context);
    }
    if (!isVoidTag(node.tag)) {
        // push closing tag
        context.pushStringPart(`</${node.tag}>`);
    }
}

// Because SSR codegen output is completely different from client-side output
// (e.g. multiple elements can be concatenated into a single template literal
// instead of each getting a corresponding call), we need to apply an extra
// transform pass to convert the template AST into a fresh JS AST before
// passing it to codegen.
function ssrCodegenTransform(ast, options) {
    const context = createSSRTransformContext(ast, options);
    // inject SFC <style> CSS variables
    // we do this instead of inlining the expression to ensure the vars are
    // only resolved once per render
    if (options.ssrCssVars) {
        const varsExp = processExpression(createSimpleExpression(options.ssrCssVars, false), createTransformContext(createRoot([]), options));
        context.body.push(createCompoundExpression([`const _cssVars = { style: `, varsExp, `}`]));
    }
    const isFragment = ast.children.length > 1 && ast.children.some(c => !isText(c));
    processChildren(ast.children, context, isFragment);
    ast.codegenNode = createBlockStatement(context.body);
    // Finalize helpers.
    // We need to separate helpers imported from 'vue' vs. '@xlboy-v3/server-renderer'
    ast.ssrHelpers = [
        ...ast.helpers.filter(h => h in ssrHelpers),
        ...context.helpers
    ];
    ast.helpers = ast.helpers.filter(h => !(h in ssrHelpers));
}
function createSSRTransformContext(root, options, helpers = new Set(), withSlotScopeId = false) {
    const body = [];
    let currentString = null;
    return {
        root,
        options,
        body,
        helpers,
        withSlotScopeId,
        onError: options.onError ||
            (e => {
                throw e;
            }),
        helper(name) {
            helpers.add(name);
            return name;
        },
        pushStringPart(part) {
            if (!currentString) {
                const currentCall = createCallExpression(`_push`);
                body.push(currentCall);
                currentString = createTemplateLiteral([]);
                currentCall.arguments.push(currentString);
            }
            const bufferedElements = currentString.elements;
            const lastItem = bufferedElements[bufferedElements.length - 1];
            if (isString(part) && isString(lastItem)) {
                bufferedElements[bufferedElements.length - 1] += part;
            }
            else {
                bufferedElements.push(part);
            }
        },
        pushStatement(statement) {
            // close current string
            currentString = null;
            body.push(statement);
        }
    };
}
function createChildContext(parent, withSlotScopeId = parent.withSlotScopeId) {
    // ensure child inherits parent helpers
    return createSSRTransformContext(parent.root, parent.options, parent.helpers, withSlotScopeId);
}
function processChildren(children, context, asFragment = false, disableNestedFragments = false) {
    if (asFragment) {
        context.pushStringPart(`<!--[-->`);
    }
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        switch (child.type) {
            case 1 /* ELEMENT */:
                switch (child.tagType) {
                    case 0 /* ELEMENT */:
                        ssrProcessElement(child, context);
                        break;
                    case 1 /* COMPONENT */:
                        ssrProcessComponent(child, context);
                        break;
                    case 2 /* SLOT */:
                        ssrProcessSlotOutlet(child, context);
                        break;
                    case 3 /* TEMPLATE */:
                        // TODO
                        break;
                    default:
                        context.onError(createSSRCompilerError(63 /* X_SSR_INVALID_AST_NODE */, child.loc));
                        // make sure we exhaust all possible types
                        const exhaustiveCheck = child;
                        return exhaustiveCheck;
                }
                break;
            case 2 /* TEXT */:
                context.pushStringPart(escapeHtml(child.content));
                break;
            case 3 /* COMMENT */:
                // no need to escape comment here because the AST can only
                // contain valid comments.
                context.pushStringPart(`<!--${child.content}-->`);
                break;
            case 5 /* INTERPOLATION */:
                context.pushStringPart(createCallExpression(context.helper(SSR_INTERPOLATE), [child.content]));
                break;
            case 9 /* IF */:
                ssrProcessIf(child, context, disableNestedFragments);
                break;
            case 11 /* FOR */:
                ssrProcessFor(child, context, disableNestedFragments);
                break;
            case 10 /* IF_BRANCH */:
                // no-op - handled by ssrProcessIf
                break;
            case 12 /* TEXT_CALL */:
            case 8 /* COMPOUND_EXPRESSION */:
                // no-op - these two types can never appear as template child node since
                // `transformText` is not used during SSR compile.
                break;
            default:
                context.onError(createSSRCompilerError(63 /* X_SSR_INVALID_AST_NODE */, child.loc));
                // make sure we exhaust all possible types
                const exhaustiveCheck = child;
                return exhaustiveCheck;
        }
    }
    if (asFragment) {
        context.pushStringPart(`<!--]-->`);
    }
}
function processChildrenAsStatement(children, parentContext, asFragment = false, withSlotScopeId = parentContext.withSlotScopeId) {
    const childContext = createChildContext(parentContext, withSlotScopeId);
    processChildren(children, childContext, asFragment);
    return createBlockStatement(childContext.body);
}

const ssrTransformModel = (dir, node, context) => {
    const model = dir.exp;
    function checkDuplicatedValue() {
        const value = findProp(node, 'value');
        if (value) {
            context.onError(createDOMCompilerError(56 /* X_V_MODEL_UNNECESSARY_VALUE */, value.loc));
        }
    }
    if (node.tagType === 0 /* ELEMENT */) {
        const res = { props: [] };
        const defaultProps = [
            // default value binding for text type inputs
            createObjectProperty(`value`, model)
        ];
        if (node.tag === 'input') {
            const type = findProp(node, 'type');
            if (type) {
                const value = findValueBinding(node);
                if (type.type === 7 /* DIRECTIVE */) {
                    // dynamic type
                    res.ssrTagParts = [
                        createCallExpression(context.helper(SSR_RENDER_DYNAMIC_MODEL), [
                            type.exp,
                            model,
                            value
                        ])
                    ];
                }
                else if (type.value) {
                    // static type
                    switch (type.value.content) {
                        case 'radio':
                            res.props = [
                                createObjectProperty(`checked`, createCallExpression(context.helper(SSR_LOOSE_EQUAL), [
                                    model,
                                    value
                                ]))
                            ];
                            break;
                        case 'checkbox':
                            const trueValueBinding = findProp(node, 'true-value');
                            if (trueValueBinding) {
                                const trueValue = trueValueBinding.type === 6 /* ATTRIBUTE */
                                    ? JSON.stringify(trueValueBinding.value.content)
                                    : trueValueBinding.exp;
                                res.props = [
                                    createObjectProperty(`checked`, createCallExpression(context.helper(SSR_LOOSE_EQUAL), [
                                        model,
                                        trueValue
                                    ]))
                                ];
                            }
                            else {
                                res.props = [
                                    createObjectProperty(`checked`, createConditionalExpression(createCallExpression(`Array.isArray`, [model]), createCallExpression(context.helper(SSR_LOOSE_CONTAIN), [
                                        model,
                                        value
                                    ]), model))
                                ];
                            }
                            break;
                        case 'file':
                            context.onError(createDOMCompilerError(55 /* X_V_MODEL_ON_FILE_INPUT_ELEMENT */, dir.loc));
                            break;
                        default:
                            checkDuplicatedValue();
                            res.props = defaultProps;
                            break;
                    }
                }
            }
            else if (hasDynamicKeyVBind(node)) ;
            else {
                // text type
                checkDuplicatedValue();
                res.props = defaultProps;
            }
        }
        else if (node.tag === 'textarea') {
            checkDuplicatedValue();
            node.children = [createInterpolation(model, model.loc)];
        }
        else if (node.tag === 'select') ;
        else {
            context.onError(createDOMCompilerError(53 /* X_V_MODEL_ON_INVALID_ELEMENT */, dir.loc));
        }
        return res;
    }
    else {
        // component v-model
        return transformModel(dir, node, context);
    }
};
function findValueBinding(node) {
    const valueBinding = findProp(node, 'value');
    return valueBinding
        ? valueBinding.type === 7 /* DIRECTIVE */
            ? valueBinding.exp
            : createSimpleExpression(valueBinding.value.content, true)
        : createSimpleExpression(`null`, false);
}

const ssrTransformShow = (dir, node, context) => {
    if (!dir.exp) {
        context.onError(createDOMCompilerError(57 /* X_V_SHOW_NO_EXPRESSION */));
    }
    return {
        props: [
            createObjectProperty(`style`, createConditionalExpression(dir.exp, createSimpleExpression(`null`, false), createObjectExpression([
                createObjectProperty(`display`, createSimpleExpression(`none`, true))
            ]), false /* no newline */))
        ]
    };
};

const hasSingleChild = (node) => node.children.filter(n => n.type !== 3 /* COMMENT */).length === 1;
const ssrInjectFallthroughAttrs = (node, context) => {
    // _attrs is provided as a function argument.
    // mark it as a known identifier so that it doesn't get prefixed by
    // transformExpression.
    if (node.type === 0 /* ROOT */) {
        context.identifiers._attrs = 1;
    }
    const parent = context.parent;
    if (!parent || parent.type !== 0 /* ROOT */) {
        return;
    }
    if (node.type === 10 /* IF_BRANCH */ && hasSingleChild(node)) {
        injectFallthroughAttrs(node.children[0]);
    }
    else if (hasSingleChild(parent)) {
        injectFallthroughAttrs(node);
    }
};
function injectFallthroughAttrs(node) {
    if (node.type === 1 /* ELEMENT */ &&
        (node.tagType === 0 /* ELEMENT */ ||
            node.tagType === 1 /* COMPONENT */) &&
        !findDir(node, 'for')) {
        node.props.push({
            type: 7 /* DIRECTIVE */,
            name: 'bind',
            arg: undefined,
            exp: createSimpleExpression(`_attrs`, false),
            modifiers: [],
            loc: locStub
        });
    }
}

const ssrInjectCssVars = (node, context) => {
    if (!context.ssrCssVars) {
        return;
    }
    // _cssVars is initialized once per render function
    // the code is injected in ssrCodegenTransform when creating the
    // ssr transform context
    if (node.type === 0 /* ROOT */) {
        context.identifiers._cssVars = 1;
    }
    const parent = context.parent;
    if (!parent || parent.type !== 0 /* ROOT */) {
        return;
    }
    if (node.type === 10 /* IF_BRANCH */) {
        for (const child of node.children) {
            injectCssVars(child);
        }
    }
    else {
        injectCssVars(node);
    }
};
function injectCssVars(node) {
    if (node.type === 1 /* ELEMENT */ &&
        (node.tagType === 0 /* ELEMENT */ ||
            node.tagType === 1 /* COMPONENT */) &&
        !findDir(node, 'for')) {
        if (isBuiltInType(node.tag, 'Suspense')) {
            for (const child of node.children) {
                if (child.type === 1 /* ELEMENT */ &&
                    child.tagType === 3 /* TEMPLATE */) {
                    // suspense slot
                    child.children.forEach(injectCssVars);
                }
                else {
                    injectCssVars(child);
                }
            }
        }
        else {
            node.props.push({
                type: 7 /* DIRECTIVE */,
                name: 'bind',
                arg: undefined,
                exp: createSimpleExpression(`_cssVars`, false),
                modifiers: [],
                loc: locStub
            });
        }
    }
}

function compile$1(template, options = {}) {
    options = {
        ...options,
        // apply DOM-specific parsing options
        ...parserOptions,
        ssr: true,
        scopeId: options.mode === 'function' ? null : options.scopeId,
        // always prefix since compiler-ssr doesn't have size concern
        prefixIdentifiers: true,
        // disable optimizations that are unnecessary for ssr
        cacheHandlers: false,
        hoistStatic: false
    };
    const ast = baseParse(template, options);
    // Save raw options for AST. This is needed when performing sub-transforms
    // on slot vnode branches.
    rawOptionsMap.set(ast, options);
    transform(ast, {
        ...options,
        nodeTransforms: [
            ssrTransformIf,
            ssrTransformFor,
            trackVForSlotScopes,
            transformExpression,
            ssrTransformSlotOutlet,
            ssrInjectFallthroughAttrs,
            ssrInjectCssVars,
            ssrTransformElement,
            ssrTransformComponent,
            trackSlotScopes,
            transformStyle,
            ...(options.nodeTransforms || []) // user transforms
        ],
        directiveTransforms: {
            // reusing core v-bind
            bind: transformBind,
            // model and show has dedicated SSR handling
            model: ssrTransformModel,
            show: ssrTransformShow,
            // the following are ignored during SSR
            on: noopDirectiveTransform,
            cloak: noopDirectiveTransform,
            once: noopDirectiveTransform,
            ...(options.directiveTransforms || {}) // user transforms
        }
    });
    // traverse the template AST and convert into SSR codegen AST
    // by replacing ast.codegenNode.
    ssrCodegenTransform(ast, options);
    return generate(ast, options);
}

var CompilerSSR = /*#__PURE__*/Object.freeze({
  __proto__: null,
  compile: compile$1
});

function preprocess({ source, filename, preprocessOptions }, preprocessor) {
    // Consolidate exposes a callback based API, but the callback is in fact
    // called synchronously for most templating engines. In our case, we have to
    // expose a synchronous API so that it is usable in Jest transforms (which
    // have to be sync because they are applied via Node.js require hooks)
    let res = '';
    let err = null;
    preprocessor.render(source, { filename, ...preprocessOptions }, (_err, _res) => {
        if (_err)
            err = _err;
        res = _res;
    });
    if (err)
        throw err;
    return res;
}
function compileTemplate(options) {
    const { preprocessLang, preprocessCustomRequire } = options;
    const preprocessor = preprocessLang
        ? preprocessCustomRequire
            ? preprocessCustomRequire(preprocessLang)
            : require('consolidate')[preprocessLang]
        : false;
    if (preprocessor) {
        try {
            return doCompileTemplate({
                ...options,
                source: preprocess(options, preprocessor)
            });
        }
        catch (e) {
            return {
                code: `export default function render() {}`,
                source: options.source,
                tips: [],
                errors: [e]
            };
        }
    }
    else if (preprocessLang) {
        return {
            code: `export default function render() {}`,
            source: options.source,
            tips: [
                `Component ${options.filename} uses lang ${preprocessLang} for template. Please install the language preprocessor.`
            ],
            errors: [
                `Component ${options.filename} uses lang ${preprocessLang} for template, however it is not installed.`
            ]
        };
    }
    else {
        return doCompileTemplate(options);
    }
}
function doCompileTemplate({ filename, id, scoped, inMap, source, ssr = false, ssrCssVars, isProd = false, compiler = ssr ? CompilerSSR : CompilerDOM, compilerOptions = {}, transformAssetUrls }) {
    const errors = [];
    let nodeTransforms = [];
    if (isObject(transformAssetUrls)) {
        const assetOptions = normalizeOptions(transformAssetUrls);
        nodeTransforms = [
            createAssetUrlTransformWithOptions(assetOptions),
            createSrcsetTransformWithOptions(assetOptions)
        ];
    }
    else if (transformAssetUrls !== false) {
        nodeTransforms = [transformAssetUrl, transformSrcset];
    }
    if (ssr && !ssrCssVars) {
        warnOnce(`compileTemplate is called with \`ssr: true\` but no ` +
            `corresponding \`cssVars\` option.\`.`);
    }
    if (!id) {
        warnOnce(`compileTemplate now requires the \`id\` option.\`.`);
        id = '';
    }
    const shortId = id.replace(/^data-v-/, '');
    const longId = `data-v-${shortId}`;
    let { code, ast, preamble, map } = compiler.compile(source, {
        mode: 'module',
        prefixIdentifiers: true,
        hoistStatic: true,
        cacheHandlers: true,
        ssrCssVars: ssr && ssrCssVars && ssrCssVars.length
            ? genCssVarsFromList(ssrCssVars, shortId, isProd)
            : '',
        scopeId: scoped ? longId : undefined,
        ...compilerOptions,
        nodeTransforms: nodeTransforms.concat(compilerOptions.nodeTransforms || []),
        filename,
        sourceMap: true,
        onError: e => errors.push(e)
    });
    // inMap should be the map produced by ./parse.ts which is a simple line-only
    // mapping. If it is present, we need to adjust the final map and errors to
    // reflect the original line numbers.
    if (inMap) {
        if (map) {
            map = mapLines(inMap, map);
        }
        if (errors.length) {
            patchErrors(errors, source, inMap);
        }
    }
    return { code, ast, preamble, source, errors, tips: [], map };
}
function mapLines(oldMap, newMap) {
    if (!oldMap)
        return newMap;
    if (!newMap)
        return oldMap;
    const oldMapConsumer = new sourceMap.SourceMapConsumer(oldMap);
    const newMapConsumer = new sourceMap.SourceMapConsumer(newMap);
    const mergedMapGenerator = new sourceMap.SourceMapGenerator();
    newMapConsumer.eachMapping(m => {
        if (m.originalLine == null) {
            return;
        }
        const origPosInOldMap = oldMapConsumer.originalPositionFor({
            line: m.originalLine,
            column: m.originalColumn
        });
        if (origPosInOldMap.source == null) {
            return;
        }
        mergedMapGenerator.addMapping({
            generated: {
                line: m.generatedLine,
                column: m.generatedColumn
            },
            original: {
                line: origPosInOldMap.line,
                // use current column, since the oldMap produced by @vue/compiler-sfc
                // does not
                column: m.originalColumn
            },
            source: origPosInOldMap.source,
            name: origPosInOldMap.name
        });
    });
    // source-map's type definition is incomplete
    const generator = mergedMapGenerator;
    oldMapConsumer.sources.forEach((sourceFile) => {
        generator._sources.add(sourceFile);
        const sourceContent = oldMapConsumer.sourceContentFor(sourceFile);
        if (sourceContent != null) {
            mergedMapGenerator.setSourceContent(sourceFile, sourceContent);
        }
    });
    generator._sourceRoot = oldMap.sourceRoot;
    generator._file = oldMap.file;
    return generator.toJSON();
}
function patchErrors(errors, source, inMap) {
    const originalSource = inMap.sourcesContent[0];
    const offset = originalSource.indexOf(source);
    const lineOffset = originalSource.slice(0, offset).split(/\r?\n/).length - 1;
    errors.forEach(err => {
        if (err.loc) {
            err.loc.start.line += lineOffset;
            err.loc.start.offset += offset;
            if (err.loc.end !== err.loc.start) {
                err.loc.end.line += lineOffset;
                err.loc.end.offset += offset;
            }
        }
    });
}

var trimPlugin = postcss__default.plugin('trim', () => (css) => {
    css.walk(({ type, raws }) => {
        if (type === 'rule' || type === 'atrule') {
            if (raws.before)
                raws.before = '\n';
            if (raws.after)
                raws.after = '\n';
        }
    });
});

const animationNameRE = /^(-\w+-)?animation-name$/;
const animationRE = /^(-\w+-)?animation$/;
var scopedPlugin = postcss__default.plugin('vue-scoped', (id) => (root) => {
    const keyframes = Object.create(null);
    const shortId = id.replace(/^data-v-/, '');
    root.each(function rewriteSelectors(node) {
        if (node.type !== 'rule') {
            // handle media queries
            if (node.type === 'atrule') {
                if (node.name === 'media' || node.name === 'supports') {
                    node.each(rewriteSelectors);
                }
                else if (/-?keyframes$/.test(node.name)) {
                    // register keyframes
                    keyframes[node.params] = node.params = node.params + '-' + shortId;
                }
            }
            return;
        }
        node.selector = selectorParser__default(selectors => {
            function rewriteSelector(selector, slotted) {
                let node = null;
                let shouldInject = true;
                // find the last child node to insert attribute selector
                selector.each(n => {
                    // DEPRECATED ">>>" and "/deep/" combinator
                    if (n.type === 'combinator' &&
                        (n.value === '>>>' || n.value === '/deep/')) {
                        n.value = ' ';
                        n.spaces.before = n.spaces.after = '';
                        warn(`the >>> and /deep/ combinators have been deprecated. ` +
                            `Use :deep() instead.`);
                        return false;
                    }
                    if (n.type === 'pseudo') {
                        const { value } = n;
                        // deep: inject [id] attribute at the node before the ::v-deep
                        // combinator.
                        if (value === ':deep' || value === '::v-deep') {
                            if (n.nodes.length) {
                                // .foo ::v-deep(.bar) -> .foo[xxxxxxx] .bar
                                // replace the current node with ::v-deep's inner selector
                                let last = n;
                                n.nodes[0].each(ss => {
                                    selector.insertAfter(last, ss);
                                    last = ss;
                                });
                                // insert a space combinator before if it doesn't already have one
                                const prev = selector.at(selector.index(n) - 1);
                                if (!prev || !isSpaceCombinator(prev)) {
                                    selector.insertAfter(n, selectorParser__default.combinator({
                                        value: ' '
                                    }));
                                }
                                selector.removeChild(n);
                            }
                            else {
                                // DEPRECATED usage
                                // .foo ::v-deep .bar -> .foo[xxxxxxx] .bar
                                warn(`::v-deep usage as a combinator has ` +
                                    `been deprecated. Use :deep(<inner-selector>) instead.`);
                                const prev = selector.at(selector.index(n) - 1);
                                if (prev && isSpaceCombinator(prev)) {
                                    selector.removeChild(prev);
                                }
                                selector.removeChild(n);
                            }
                            return false;
                        }
                        // slot: use selector inside `::v-slotted` and inject [id + '-s']
                        // instead.
                        // ::v-slotted(.foo) -> .foo[xxxxxxx-s]
                        if (value === ':slotted' || value === '::v-slotted') {
                            rewriteSelector(n.nodes[0], true /* slotted */);
                            let last = n;
                            n.nodes[0].each(ss => {
                                selector.insertAfter(last, ss);
                                last = ss;
                            });
                            // selector.insertAfter(n, n.nodes[0])
                            selector.removeChild(n);
                            // since slotted attribute already scopes the selector there's no
                            // need for the non-slot attribute.
                            shouldInject = false;
                            return false;
                        }
                        // global: replace with inner selector and do not inject [id].
                        // ::v-global(.foo) -> .foo
                        if (value === ':global' || value === '::v-global') {
                            selectors.insertAfter(selector, n.nodes[0]);
                            selectors.removeChild(selector);
                            return false;
                        }
                    }
                    if (n.type !== 'pseudo' && n.type !== 'combinator') {
                        node = n;
                    }
                });
                if (node) {
                    node.spaces.after = '';
                }
                else {
                    // For deep selectors & standalone pseudo selectors,
                    // the attribute selectors are prepended rather than appended.
                    // So all leading spaces must be eliminated to avoid problems.
                    selector.first.spaces.before = '';
                }
                if (shouldInject) {
                    const idToAdd = slotted ? id + '-s' : id;
                    selector.insertAfter(
                    // If node is null it means we need to inject [id] at the start
                    // insertAfter can handle `null` here
                    node, selectorParser__default.attribute({
                        attribute: idToAdd,
                        value: idToAdd,
                        raws: {},
                        quoteMark: `"`
                    }));
                }
            }
            selectors.each(selector => rewriteSelector(selector));
        }).processSync(node.selector);
    });
    if (Object.keys(keyframes).length) {
        // If keyframes are found in this <style>, find and rewrite animation names
        // in declarations.
        // Caveat: this only works for keyframes and animation rules in the same
        // <style> element.
        // individual animation-name declaration
        root.walkDecls(decl => {
            if (animationNameRE.test(decl.prop)) {
                decl.value = decl.value
                    .split(',')
                    .map(v => keyframes[v.trim()] || v.trim())
                    .join(',');
            }
            // shorthand
            if (animationRE.test(decl.prop)) {
                decl.value = decl.value
                    .split(',')
                    .map(v => {
                    const vals = v.trim().split(/\s+/);
                    const i = vals.findIndex(val => keyframes[val]);
                    if (i !== -1) {
                        vals.splice(i, 1, keyframes[vals[i]]);
                        return vals.join(' ');
                    }
                    else {
                        return v;
                    }
                })
                    .join(',');
            }
        });
    }
});
function isSpaceCombinator(node) {
    return node.type === 'combinator' && /^\s+$/.test(node.value);
}

// .scss/.sass processor
const scss = (source, map, options, load = require) => {
    const nodeSass = load('sass');
    const finalOptions = {
        ...options,
        data: getSource(source, options.filename, options.additionalData),
        file: options.filename,
        outFile: options.filename,
        sourceMap: !!map
    };
    try {
        const result = nodeSass.renderSync(finalOptions);
        const dependencies = result.stats.includedFiles;
        if (map) {
            return {
                code: result.css.toString(),
                map: merge__default(map, JSON.parse(result.map.toString())),
                errors: [],
                dependencies
            };
        }
        return { code: result.css.toString(), errors: [], dependencies };
    }
    catch (e) {
        return { code: '', errors: [e], dependencies: [] };
    }
};
const sass = (source, map, options, load) => scss(source, map, {
    ...options,
    indentedSyntax: true
}, load);
// .less
const less = (source, map, options, load = require) => {
    const nodeLess = load('less');
    let result;
    let error = null;
    nodeLess.render(getSource(source, options.filename, options.additionalData), { ...options, syncImport: true }, (err, output) => {
        error = err;
        result = output;
    });
    if (error)
        return { code: '', errors: [error], dependencies: [] };
    const dependencies = result.imports;
    if (map) {
        return {
            code: result.css.toString(),
            map: merge__default(map, result.map),
            errors: [],
            dependencies: dependencies
        };
    }
    return {
        code: result.css.toString(),
        errors: [],
        dependencies: dependencies
    };
};
// .styl
const styl = (source, map, options, load = require) => {
    const nodeStylus = load('stylus');
    try {
        const ref = nodeStylus(source);
        Object.keys(options).forEach(key => ref.set(key, options[key]));
        if (map)
            ref.set('sourcemap', { inline: false, comment: false });
        const result = ref.render();
        const dependencies = ref.deps();
        if (map) {
            return {
                code: result,
                map: merge__default(map, ref.sourcemap),
                errors: [],
                dependencies
            };
        }
        return { code: result, errors: [], dependencies };
    }
    catch (e) {
        return { code: '', errors: [e], dependencies: [] };
    }
};
function getSource(source, filename, additionalData) {
    if (!additionalData)
        return source;
    if (isFunction(additionalData)) {
        return additionalData(source, filename);
    }
    return additionalData + source;
}
const processors = {
    less,
    sass,
    scss,
    styl,
    stylus: styl
};

function compileStyle(options) {
    return doCompileStyle({
        ...options,
        isAsync: false
    });
}
function compileStyleAsync(options) {
    return doCompileStyle({ ...options, isAsync: true });
}
function doCompileStyle(options) {
    const { filename, id, scoped = false, trim = true, isProd = false, modules = false, modulesOptions = {}, preprocessLang, postcssOptions, postcssPlugins } = options;
    const preprocessor = preprocessLang && processors[preprocessLang];
    const preProcessedSource = preprocessor && preprocess$1(options, preprocessor);
    const map = preProcessedSource
        ? preProcessedSource.map
        : options.inMap || options.map;
    const source = preProcessedSource ? preProcessedSource.code : options.source;
    const shortId = id.replace(/^data-v-/, '');
    const longId = `data-v-${shortId}`;
    const plugins = (postcssPlugins || []).slice();
    plugins.unshift(cssVarsPlugin({ id: shortId, isProd }));
    if (trim) {
        plugins.push(trimPlugin());
    }
    if (scoped) {
        plugins.push(scopedPlugin(longId));
    }
    let cssModules;
    if (modules) {
        if (!options.isAsync) {
            throw new Error('[@vue/compiler-sfc] `modules` option can only be used with compileStyleAsync().');
        }
        plugins.push(require('postcss-modules')({
            ...modulesOptions,
            getJSON: (_cssFileName, json) => {
                cssModules = json;
            }
        }));
    }
    const postCSSOptions = {
        ...postcssOptions,
        to: filename,
        from: filename
    };
    if (map) {
        postCSSOptions.map = {
            inline: false,
            annotation: false,
            prev: map
        };
    }
    let result;
    let code;
    let outMap;
    // stylus output include plain css. so need remove the repeat item
    const dependencies = new Set(preProcessedSource ? preProcessedSource.dependencies : []);
    // sass has filename self when provided filename option
    dependencies.delete(filename);
    const errors = [];
    if (preProcessedSource && preProcessedSource.errors.length) {
        errors.push(...preProcessedSource.errors);
    }
    const recordPlainCssDependencies = (messages) => {
        messages.forEach(msg => {
            if (msg.type === 'dependency') {
                // postcss output path is absolute position path
                dependencies.add(msg.file);
            }
        });
        return dependencies;
    };
    try {
        result = postcss__default(plugins).process(source, postCSSOptions);
        // In async mode, return a promise.
        if (options.isAsync) {
            return result
                .then(result => ({
                code: result.css || '',
                map: result.map && result.map.toJSON(),
                errors,
                modules: cssModules,
                rawResult: result,
                dependencies: recordPlainCssDependencies(result.messages)
            }))
                .catch(error => ({
                code: '',
                map: undefined,
                errors: [...errors, error],
                rawResult: undefined,
                dependencies
            }));
        }
        recordPlainCssDependencies(result.messages);
        // force synchronous transform (we know we only have sync plugins)
        code = result.css;
        outMap = result.map;
    }
    catch (e) {
        errors.push(e);
    }
    return {
        code: code || ``,
        map: outMap && outMap.toJSON(),
        errors,
        rawResult: result,
        dependencies
    };
}
function preprocess$1(options, preprocessor) {
    return preprocessor(options.source, options.map, {
        filename: options.filename,
        ...options.preprocessOptions
    }, options.preprocessCustomRequire);
}

const defaultExportRE = /((?:^|\n|;)\s*)export(\s*)default/;
const namedDefaultExportRE = /((?:^|\n|;)\s*)export(.+)as(\s*)default/;
/**
 * Utility for rewriting `export default` in a script block into a variable
 * declaration so that we can inject things into it
 */
function rewriteDefault(input, as, parserPlugins) {
    if (!hasDefaultExport(input)) {
        return input + `\nconst ${as} = {}`;
    }
    const replaced = input.replace(defaultExportRE, `$1const ${as} =`);
    if (!hasDefaultExport(replaced)) {
        return replaced;
    }
    // if the script somehow still contains `default export`, it probably has
    // multi-line comments or template strings. fallback to a full parse.
    const s = new MagicString__default(input);
    const ast = parser.parse(input, {
        sourceType: 'module',
        plugins: parserPlugins
    }).program.body;
    ast.forEach(node => {
        if (node.type === 'ExportDefaultDeclaration') {
            s.overwrite(node.start, node.declaration.start, `const ${as} = `);
        }
        if (node.type === 'ExportNamedDeclaration') {
            node.specifiers.forEach(specifier => {
                if (specifier.type === 'ExportSpecifier' &&
                    specifier.exported.type === 'Identifier' &&
                    specifier.exported.name === 'default') {
                    const end = specifier.end;
                    s.overwrite(specifier.start, input.charAt(end) === ',' ? end + 1 : end, ``);
                    s.append(`\nconst ${as} = ${specifier.local.name}`);
                }
            });
        }
    });
    return s.toString();
}
function hasDefaultExport(input) {
    return defaultExportRE.test(input) || namedDefaultExportRE.test(input);
}

const DEFINE_PROPS = 'defineProps';
const DEFINE_EMIT = 'defineEmit';
/**
 * Compile `<script setup>`
 * It requires the whole SFC descriptor because we need to handle and merge
 * normal `<script>` + `<script setup>` if both are present.
 */
function compileScript(sfc, options) {
    const { script, scriptSetup, source, filename } = sfc;
    if (scriptSetup) {
        warnExperimental(`<script setup>`, 227);
    }
    // for backwards compat
    if (!options) {
        options = { id: '' };
    }
    if (!options.id) {
        warnOnce(`compileScript now requires passing the \`id\` option.\n` +
            `Upgrade your vite or vue-loader version for compatibility with ` +
            `the latest experimental proposals.`);
    }
    const scopeId = options.id ? options.id.replace(/^data-v-/, '') : '';
    const cssVars = sfc.cssVars;
    const hasInheritAttrsFlag = sfc.template && sfc.template.attrs['inherit-attrs'] === 'false';
    const scriptLang = script && script.lang;
    const scriptSetupLang = scriptSetup && scriptSetup.lang;
    const isTS = scriptLang === 'ts' || scriptSetupLang === 'ts';
    const plugins = [...babelParserDefaultPlugins, 'jsx'];
    if (options.babelParserPlugins)
        plugins.push(...options.babelParserPlugins);
    if (isTS)
        plugins.push('typescript', 'decorators-legacy');
    if (!scriptSetup) {
        if (!script) {
            throw new Error(`[@vue/compiler-sfc] SFC contains no <script> tags.`);
        }
        if (scriptLang && scriptLang !== 'ts') {
            // do not process non js/ts script blocks
            return script;
        }
        try {
            const scriptAst = parser.parse(script.content, {
                plugins,
                sourceType: 'module'
            }).program.body;
            const bindings = analyzeScriptBindings(scriptAst);
            const needRewrite = cssVars.length || hasInheritAttrsFlag;
            let content = script.content;
            if (needRewrite) {
                content = rewriteDefault(content, `__default__`, plugins);
                if (cssVars.length) {
                    content += genNormalScriptCssVarsCode(cssVars, bindings, scopeId, !!options.isProd);
                }
                if (hasInheritAttrsFlag) {
                    content += `__default__.inheritAttrs = false`;
                }
                content += `\nexport default __default__`;
            }
            return {
                ...script,
                content,
                bindings,
                scriptAst
            };
        }
        catch (e) {
            // silently fallback if parse fails since user may be using custom
            // babel syntax
            return script;
        }
    }
    if (script && scriptLang !== scriptSetupLang) {
        throw new Error(`[@vue/compiler-sfc] <script> and <script setup> must have the same language type.`);
    }
    if (scriptSetupLang && scriptSetupLang !== 'ts') {
        // do not process non js/ts script blocks
        return scriptSetup;
    }
    const defaultTempVar = `__default__`;
    const bindingMetadata = {};
    const helperImports = new Set();
    const userImports = Object.create(null);
    const userImportAlias = Object.create(null);
    const setupBindings = Object.create(null);
    const refBindings = Object.create(null);
    const refIdentifiers = new Set();
    const enableRefSugar = options.refSugar !== false;
    let defaultExport;
    let hasDefinePropsCall = false;
    let hasDefineEmitCall = false;
    let propsRuntimeDecl;
    let propsTypeDecl;
    let propsIdentifier;
    let emitRuntimeDecl;
    let emitTypeDecl;
    let emitIdentifier;
    let hasAwait = false;
    let hasInlinedSsrRenderFn = false;
    // props/emits declared via types
    const typeDeclaredProps = {};
    const typeDeclaredEmits = new Set();
    // record declared types for runtime props type generation
    const declaredTypes = {};
    // magic-string state
    const s = new MagicString__default(source);
    const startOffset = scriptSetup.loc.start.offset;
    const endOffset = scriptSetup.loc.end.offset;
    const scriptStartOffset = script && script.loc.start.offset;
    const scriptEndOffset = script && script.loc.end.offset;
    function helper(key) {
        helperImports.add(key);
        return `_${key}`;
    }
    function parse(input, options, offset) {
        try {
            return parser.parse(input, options).program.body;
        }
        catch (e) {
            e.message = `[@vue/compiler-sfc] ${e.message}\n\n${sfc.filename}\n${generateCodeFrame(source, e.pos + offset, e.pos + offset + 1)}`;
            throw e;
        }
    }
    function error(msg, node, end = node.end + startOffset) {
        throw new Error(`[@vue/compiler-sfc] ${msg}\n\n${sfc.filename}\n${generateCodeFrame(source, node.start + startOffset, end)}`);
    }
    function registerUserImport(source, local, imported, isType) {
        if (source === 'vue' && imported) {
            userImportAlias[imported] = local;
        }
        userImports[local] = {
            isType,
            imported: imported || 'default',
            source
        };
    }
    function processDefineProps(node) {
        if (isCallOf(node, DEFINE_PROPS)) {
            if (hasDefinePropsCall) {
                error(`duplicate ${DEFINE_PROPS}() call`, node);
            }
            hasDefinePropsCall = true;
            propsRuntimeDecl = node.arguments[0];
            // context call has type parameters - infer runtime types from it
            if (node.typeParameters) {
                if (propsRuntimeDecl) {
                    error(`${DEFINE_PROPS}() cannot accept both type and non-type arguments ` +
                        `at the same time. Use one or the other.`, node);
                }
                const typeArg = node.typeParameters.params[0];
                if (typeArg.type === 'TSTypeLiteral') {
                    propsTypeDecl = typeArg;
                }
                else {
                    error(`type argument passed to ${DEFINE_PROPS}() must be a literal type.`, typeArg);
                }
            }
            return true;
        }
        return false;
    }
    function processDefineEmit(node) {
        if (isCallOf(node, DEFINE_EMIT)) {
            if (hasDefineEmitCall) {
                error(`duplicate ${DEFINE_EMIT}() call`, node);
            }
            hasDefineEmitCall = true;
            emitRuntimeDecl = node.arguments[0];
            if (node.typeParameters) {
                if (emitRuntimeDecl) {
                    error(`${DEFINE_EMIT}() cannot accept both type and non-type arguments ` +
                        `at the same time. Use one or the other.`, node);
                }
                const typeArg = node.typeParameters.params[0];
                if (typeArg.type === 'TSFunctionType' ||
                    typeArg.type === 'TSUnionType') {
                    emitTypeDecl = typeArg;
                }
                else {
                    error(`type argument passed to ${DEFINE_EMIT}() must be a function type ` +
                        `or a union of function types.`, typeArg);
                }
            }
            return true;
        }
        return false;
    }
    function checkInvalidScopeReference(node, method) {
        if (!node)
            return;
        walkIdentifiers(node, id => {
            if (setupBindings[id.name]) {
                error(`\`${method}()\` in <script setup> cannot reference locally ` +
                    `declared variables because it will be hoisted outside of the ` +
                    `setup() function. If your component options requires initialization ` +
                    `in the module scope, use a separate normal <script> to export ` +
                    `the options instead.`, id);
            }
        });
    }
    function processRefExpression(exp, statement) {
        if (exp.type === 'AssignmentExpression') {
            const { left, right } = exp;
            if (left.type === 'Identifier') {
                registerRefBinding(left);
                s.prependRight(right.start + startOffset, `${helper('ref')}(`);
                s.appendLeft(right.end + startOffset, ')');
            }
            else if (left.type === 'ObjectPattern') {
                // remove wrapping parens
                for (let i = left.start; i > 0; i--) {
                    const char = source[i + startOffset];
                    if (char === '(') {
                        s.remove(i + startOffset, i + startOffset + 1);
                        break;
                    }
                }
                for (let i = left.end; i > 0; i++) {
                    const char = source[i + startOffset];
                    if (char === ')') {
                        s.remove(i + startOffset, i + startOffset + 1);
                        break;
                    }
                }
                processRefObjectPattern(left, statement);
            }
            else if (left.type === 'ArrayPattern') {
                processRefArrayPattern(left, statement);
            }
        }
        else if (exp.type === 'SequenceExpression') {
            // possible multiple declarations
            // ref: x = 1, y = 2
            exp.expressions.forEach(e => processRefExpression(e, statement));
        }
        else if (exp.type === 'Identifier') {
            registerRefBinding(exp);
            s.appendLeft(exp.end + startOffset, ` = ${helper('ref')}()`);
        }
        else {
            error(`ref: statements can only contain assignment expressions.`, exp);
        }
    }
    function registerRefBinding(id) {
        if (id.name[0] === '$') {
            error(`ref variable identifiers cannot start with $.`, id);
        }
        refBindings[id.name] = setupBindings[id.name] = "setup-ref" /* SETUP_REF */;
        refIdentifiers.add(id);
    }
    function processRefObjectPattern(pattern, statement) {
        for (const p of pattern.properties) {
            let nameId;
            if (p.type === 'ObjectProperty') {
                if (p.key.start === p.value.start) {
                    // shorthand { foo } --> { foo: __foo }
                    nameId = p.key;
                    s.appendLeft(nameId.end + startOffset, `: __${nameId.name}`);
                    if (p.value.type === 'AssignmentPattern') {
                        // { foo = 1 }
                        refIdentifiers.add(p.value.left);
                    }
                }
                else {
                    if (p.value.type === 'Identifier') {
                        // { foo: bar } --> { foo: __bar }
                        nameId = p.value;
                        s.prependRight(nameId.start + startOffset, `__`);
                    }
                    else if (p.value.type === 'ObjectPattern') {
                        processRefObjectPattern(p.value, statement);
                    }
                    else if (p.value.type === 'ArrayPattern') {
                        processRefArrayPattern(p.value, statement);
                    }
                    else if (p.value.type === 'AssignmentPattern') {
                        // { foo: bar = 1 } --> { foo: __bar = 1 }
                        nameId = p.value.left;
                        s.prependRight(nameId.start + startOffset, `__`);
                    }
                }
            }
            else {
                // rest element { ...foo } --> { ...__foo }
                nameId = p.argument;
                s.prependRight(nameId.start + startOffset, `__`);
            }
            if (nameId) {
                registerRefBinding(nameId);
                // append binding declarations after the parent statement
                s.appendLeft(statement.end + startOffset, `\nconst ${nameId.name} = ${helper('ref')}(__${nameId.name});`);
            }
        }
    }
    function processRefArrayPattern(pattern, statement) {
        for (const e of pattern.elements) {
            if (!e)
                continue;
            let nameId;
            if (e.type === 'Identifier') {
                // [a] --> [__a]
                nameId = e;
            }
            else if (e.type === 'AssignmentPattern') {
                // [a = 1] --> [__a = 1]
                nameId = e.left;
            }
            else if (e.type === 'RestElement') {
                // [...a] --> [...__a]
                nameId = e.argument;
            }
            else if (e.type === 'ObjectPattern') {
                processRefObjectPattern(e, statement);
            }
            else if (e.type === 'ArrayPattern') {
                processRefArrayPattern(e, statement);
            }
            if (nameId) {
                registerRefBinding(nameId);
                // prefix original
                s.prependRight(nameId.start + startOffset, `__`);
                // append binding declarations after the parent statement
                s.appendLeft(statement.end + startOffset, `\nconst ${nameId.name} = ${helper('ref')}(__${nameId.name});`);
            }
        }
    }
    // 1. process normal <script> first if it exists
    let scriptAst;
    if (script) {
        // import dedupe between <script> and <script setup>
        scriptAst = parse(script.content, {
            plugins,
            sourceType: 'module'
        }, scriptStartOffset);
        for (const node of scriptAst) {
            if (node.type === 'ImportDeclaration') {
                // record imports for dedupe
                for (const specifier of node.specifiers) {
                    const imported = specifier.type === 'ImportSpecifier' &&
                        specifier.imported.type === 'Identifier' &&
                        specifier.imported.name;
                    registerUserImport(node.source.value, specifier.local.name, imported, node.importKind === 'type');
                }
            }
            else if (node.type === 'ExportDefaultDeclaration') {
                // export default
                defaultExport = node;
                const start = node.start + scriptStartOffset;
                s.overwrite(start, start + `export default`.length, `const ${defaultTempVar} =`);
            }
            else if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
                const defaultSpecifier = node.specifiers.find(s => s.exported.type === 'Identifier' && s.exported.name === 'default');
                if (defaultSpecifier) {
                    defaultExport = node;
                    // 1. remove specifier
                    if (node.specifiers.length > 1) {
                        s.remove(defaultSpecifier.start + scriptStartOffset, defaultSpecifier.end + scriptStartOffset);
                    }
                    else {
                        s.remove(node.start + scriptStartOffset, node.end + scriptStartOffset);
                    }
                    if (node.source) {
                        // export { x as default } from './x'
                        // rewrite to `import { x as __default__ } from './x'` and
                        // add to top
                        s.prepend(`import { ${defaultSpecifier.local.name} as ${defaultTempVar} } from '${node.source.value}'\n`);
                    }
                    else {
                        // export { x as default }
                        // rewrite to `const __default__ = x` and move to end
                        s.append(`\nconst ${defaultTempVar} = ${defaultSpecifier.local.name}\n`);
                    }
                }
            }
        }
    }
    // 2. parse <script setup> and  walk over top level statements
    const scriptSetupAst = parse(scriptSetup.content, {
        plugins: [
            ...plugins,
            // allow top level await but only inside <script setup>
            'topLevelAwait'
        ],
        sourceType: 'module'
    }, startOffset);
    for (const node of scriptSetupAst) {
        const start = node.start + startOffset;
        let end = node.end + startOffset;
        // import or type declarations: move to top
        // locate comment
        if (node.trailingComments && node.trailingComments.length > 0) {
            const lastCommentNode = node.trailingComments[node.trailingComments.length - 1];
            end = lastCommentNode.end + startOffset;
        }
        // locate the end of whitespace between this statement and the next
        while (end <= source.length) {
            if (!/\s/.test(source.charAt(end))) {
                break;
            }
            end++;
        }
        // process `ref: x` bindings (convert to refs)
        if (node.type === 'LabeledStatement' &&
            node.label.name === 'ref' &&
            node.body.type === 'ExpressionStatement') {
            if (enableRefSugar) {
                warnExperimental(`ref: sugar`, 228);
                s.overwrite(node.label.start + startOffset, node.body.start + startOffset, 'const ');
                processRefExpression(node.body.expression, node);
            }
            else {
                // TODO if we end up shipping ref: sugar as an opt-in feature,
                // need to proxy the option in vite, vue-loader and rollup-plugin-vue.
                error(`ref: sugar needs to be explicitly enabled via vite or vue-loader options.`, node);
            }
        }
        if (node.type === 'ImportDeclaration') {
            // import declarations are moved to top
            s.move(start, end, 0);
            // dedupe imports
            let removed = 0;
            let prev, next;
            const removeSpecifier = (node) => {
                removed++;
                s.remove(prev ? prev.end + startOffset : node.start + startOffset, next && !prev ? next.start + startOffset : node.end + startOffset);
            };
            for (let i = 0; i < node.specifiers.length; i++) {
                const specifier = node.specifiers[i];
                prev = node.specifiers[i - 1];
                next = node.specifiers[i + 1];
                const local = specifier.local.name;
                const imported = specifier.type === 'ImportSpecifier' &&
                    specifier.imported.type === 'Identifier' &&
                    specifier.imported.name;
                const source = node.source.value;
                const existing = userImports[local];
                if (source === 'vue' &&
                    (imported === DEFINE_PROPS || imported === DEFINE_EMIT)) {
                    removeSpecifier(specifier);
                }
                else if (existing) {
                    if (existing.source === source && existing.imported === imported) {
                        // already imported in <script setup>, dedupe
                        removeSpecifier(specifier);
                    }
                    else {
                        error(`different imports aliased to same local name.`, specifier);
                    }
                }
                else {
                    registerUserImport(source, local, imported, node.importKind === 'type');
                }
            }
            if (node.specifiers.length && removed === node.specifiers.length) {
                s.remove(node.start + startOffset, node.end + startOffset);
            }
        }
        // process `defineProps` and `defineEmit` calls
        if (node.type === 'ExpressionStatement' &&
            (processDefineProps(node.expression) ||
                processDefineEmit(node.expression))) {
            s.remove(node.start + startOffset, node.end + startOffset);
        }
        if (node.type === 'VariableDeclaration' && !node.declare) {
            for (const decl of node.declarations) {
                if (decl.init) {
                    const isDefineProps = processDefineProps(decl.init);
                    if (isDefineProps) {
                        propsIdentifier = scriptSetup.content.slice(decl.id.start, decl.id.end);
                    }
                    const isDefineEmit = processDefineEmit(decl.init);
                    if (isDefineEmit) {
                        emitIdentifier = scriptSetup.content.slice(decl.id.start, decl.id.end);
                    }
                    if (isDefineProps || isDefineEmit)
                        if (node.declarations.length === 1) {
                            s.remove(node.start + startOffset, node.end + startOffset);
                        }
                        else {
                            s.remove(decl.start + startOffset, decl.end + startOffset);
                        }
                }
            }
        }
        // walk decalrations to record declared bindings
        if ((node.type === 'VariableDeclaration' ||
            node.type === 'FunctionDeclaration' ||
            node.type === 'ClassDeclaration') &&
            !node.declare) {
            walkDeclaration(node, setupBindings, userImportAlias);
        }
        // Type declarations
        if (node.type === 'VariableDeclaration' && node.declare) {
            s.remove(start, end);
        }
        // move all type declarations to outer scope
        if (node.type.startsWith('TS') ||
            (node.type === 'ExportNamedDeclaration' && node.exportKind === 'type')) {
            recordType(node, declaredTypes);
            s.move(start, end, 0);
        }
        // walk statements & named exports / variable declarations for top level
        // await
        if ((node.type === 'VariableDeclaration' && !node.declare) ||
            node.type.endsWith('Statement')) {
            estreeWalker.walk(node, {
                enter(node) {
                    if (isFunction$2(node)) {
                        this.skip();
                    }
                    if (node.type === 'AwaitExpression') {
                        hasAwait = true;
                    }
                }
            });
        }
        if ((node.type === 'ExportNamedDeclaration' && node.exportKind !== 'type') ||
            node.type === 'ExportAllDeclaration' ||
            node.type === 'ExportDefaultDeclaration') {
            error(`<script setup> cannot contain ES module exports. ` +
                `If you are using a previous version of <script setup>, please ` +
                `consult the updated RFC at https://github.com/vuejs/rfcs/pull/227.`, node);
        }
    }
    // 3. Do a full walk to rewrite identifiers referencing let exports with ref
    // value access
    if (enableRefSugar && Object.keys(refBindings).length) {
        for (const node of scriptSetupAst) {
            if (node.type !== 'ImportDeclaration') {
                walkIdentifiers(node, (id, parent) => {
                    if (refBindings[id.name] && !refIdentifiers.has(id)) {
                        if (isStaticProperty$1(parent) && parent.shorthand) {
                            // let binding used in a property shorthand
                            // { foo } -> { foo: foo.value }
                            // skip for destructure patterns
                            if (!parent.inPattern ||
                                isInDestructureAssignment$1(parent, parentStack)) {
                                s.appendLeft(id.end + startOffset, `: ${id.name}.value`);
                            }
                        }
                        else {
                            s.appendLeft(id.end + startOffset, '.value');
                        }
                    }
                    else if (id.name[0] === '$' && refBindings[id.name.slice(1)]) {
                        // $xxx raw ref access variables, remove the $ prefix
                        s.remove(id.start + startOffset, id.start + startOffset + 1);
                    }
                });
            }
        }
    }
    // 4. extract runtime props/emits code from setup context type
    if (propsTypeDecl) {
        extractRuntimeProps(propsTypeDecl, typeDeclaredProps, declaredTypes);
    }
    if (emitTypeDecl) {
        extractRuntimeEmits(emitTypeDecl, typeDeclaredEmits);
    }
    // 5. check useOptions args to make sure it doesn't reference setup scope
    // variables
    checkInvalidScopeReference(propsRuntimeDecl, DEFINE_PROPS);
    checkInvalidScopeReference(emitRuntimeDecl, DEFINE_PROPS);
    // 6. remove non-script content
    if (script) {
        if (startOffset < scriptStartOffset) {
            // <script setup> before <script>
            s.remove(0, startOffset);
            s.remove(endOffset, scriptStartOffset);
            s.remove(scriptEndOffset, source.length);
        }
        else {
            // <script> before <script setup>
            s.remove(0, scriptStartOffset);
            s.remove(scriptEndOffset, startOffset);
            s.remove(endOffset, source.length);
        }
    }
    else {
        // only <script setup>
        s.remove(0, startOffset);
        s.remove(endOffset, source.length);
    }
    // 7. analyze binding metadata
    if (scriptAst) {
        Object.assign(bindingMetadata, analyzeScriptBindings(scriptAst));
    }
    if (propsRuntimeDecl) {
        for (const key of getObjectOrArrayExpressionKeys(propsRuntimeDecl)) {
            bindingMetadata[key] = "props" /* PROPS */;
        }
    }
    for (const key in typeDeclaredProps) {
        bindingMetadata[key] = "props" /* PROPS */;
    }
    for (const [key, { isType, imported, source }] of Object.entries(userImports)) {
        if (isType)
            continue;
        bindingMetadata[key] =
            (imported === 'default' && source.endsWith('.vue')) || source === 'vue'
                ? "setup-const" /* SETUP_CONST */
                : "setup-maybe-ref" /* SETUP_MAYBE_REF */;
    }
    for (const key in setupBindings) {
        bindingMetadata[key] = setupBindings[key];
    }
    // 8. inject `useCssVars` calls
    if (cssVars.length) {
        helperImports.add(CSS_VARS_HELPER);
        helperImports.add('unref');
        s.prependRight(startOffset, `\n${genCssVarsCode(cssVars, bindingMetadata, scopeId, !!options.isProd)}\n`);
    }
    // 9. finalize setup() argument signature
    let args = `__props`;
    if (propsTypeDecl) {
        args += `: ${scriptSetup.content.slice(propsTypeDecl.start, propsTypeDecl.end)}`;
    }
    // inject user assignment of props
    // we use a default __props so that template expressions referencing props
    // can use it directly
    if (propsIdentifier) {
        s.prependRight(startOffset, `\nconst ${propsIdentifier} = __props`);
    }
    if (emitIdentifier) {
        args +=
            emitIdentifier === `emit` ? `, { emit }` : `, { emit: ${emitIdentifier} }`;
        if (emitTypeDecl) {
            args += `: {
        emit: (${scriptSetup.content.slice(emitTypeDecl.start, emitTypeDecl.end)}),
        slots: any,
        attrs: any
      }`;
        }
    }
    // 10. generate return statement
    let returned;
    if (options.inlineTemplate) {
        if (sfc.template && !sfc.template.src) {
            if (options.templateOptions && options.templateOptions.ssr) {
                hasInlinedSsrRenderFn = true;
            }
            // inline render function mode - we are going to compile the template and
            // inline it right here
            const { code, ast, preamble, tips, errors } = compileTemplate({
                filename,
                source: sfc.template.content,
                inMap: sfc.template.map,
                ...options.templateOptions,
                id: scopeId,
                scoped: sfc.styles.some(s => s.scoped),
                isProd: options.isProd,
                ssrCssVars: sfc.cssVars,
                compilerOptions: {
                    ...(options.templateOptions &&
                        options.templateOptions.compilerOptions),
                    inline: true,
                    isTS,
                    bindingMetadata
                }
            });
            if (tips.length) {
                tips.forEach(warnOnce);
            }
            const err = errors[0];
            if (typeof err === 'string') {
                throw new Error(err);
            }
            else if (err) {
                if (err.loc) {
                    err.message +=
                        `\n\n` +
                            sfc.filename +
                            '\n' +
                            generateCodeFrame(source, err.loc.start.offset, err.loc.end.offset) +
                            `\n`;
                }
                throw err;
            }
            if (preamble) {
                s.prepend(preamble);
            }
            // avoid duplicated unref import
            // as this may get injected by the render function preamble OR the
            // css vars codegen
            if (ast && ast.helpers.includes(UNREF)) {
                helperImports.delete('unref');
            }
            returned = code;
        }
        else {
            returned = `() => {}`;
        }
    }
    else {
        // return bindings from setup
        const allBindings = { ...setupBindings };
        for (const key in userImports) {
            if (!userImports[key].isType) {
                allBindings[key] = true;
            }
        }
        returned = `{ ${Object.keys(allBindings).join(', ')} }`;
    }
    s.appendRight(endOffset, `\nreturn ${returned}\n}\n\n`);
    // 11. finalize default export
    // expose: [] makes <script setup> components "closed" by default.
    let runtimeOptions = `\n  expose: [],`;
    if (hasInheritAttrsFlag) {
        runtimeOptions += `\n  inheritAttrs: false,`;
    }
    if (hasInlinedSsrRenderFn) {
        runtimeOptions += `\n  __ssrInlineRender: true,`;
    }
    if (propsRuntimeDecl) {
        runtimeOptions += `\n  props: ${scriptSetup.content
            .slice(propsRuntimeDecl.start, propsRuntimeDecl.end)
            .trim()},`;
    }
    else if (propsTypeDecl) {
        runtimeOptions += genRuntimeProps(typeDeclaredProps);
    }
    if (emitRuntimeDecl) {
        runtimeOptions += `\n  emits: ${scriptSetup.content
            .slice(emitRuntimeDecl.start, emitRuntimeDecl.end)
            .trim()},`;
    }
    else if (emitTypeDecl) {
        runtimeOptions += genRuntimeEmits(typeDeclaredEmits);
    }
    if (isTS) {
        // for TS, make sure the exported type is still valid type with
        // correct props information
        // we have to use object spread for types to be merged properly
        // user's TS setting should compile it down to proper targets
        const def = defaultExport ? `\n  ...${defaultTempVar},` : ``;
        // wrap setup code with function.
        // export the content of <script setup> as a named export, `setup`.
        // this allows `import { setup } from '*.vue'` for testing purposes.
        s.prependLeft(startOffset, `\nexport default ${helper(`defineComponent`)}({${def}${runtimeOptions}\n  ${hasAwait ? `async ` : ``}setup(${args}) {\n`);
        s.appendRight(endOffset, `})`);
    }
    else {
        if (defaultExport) {
            // can't rely on spread operator in non ts mode
            s.prependLeft(startOffset, `\n${hasAwait ? `async ` : ``}function setup(${args}) {\n`);
            s.append(`\nexport default /*#__PURE__*/ Object.assign(${defaultTempVar}, {${runtimeOptions}\n  setup\n})\n`);
        }
        else {
            s.prependLeft(startOffset, `\nexport default {${runtimeOptions}\n  ` +
                `${hasAwait ? `async ` : ``}setup(${args}) {\n`);
            s.appendRight(endOffset, `}`);
        }
    }
    // 12. finalize Vue helper imports
    if (helperImports.size > 0) {
        s.prepend(`import { ${[...helperImports]
            .map(h => `${h} as _${h}`)
            .join(', ')} } from 'vue'\n`);
    }
    s.trim();
    return {
        ...scriptSetup,
        bindings: bindingMetadata,
        content: s.toString(),
        map: s.generateMap({
            source: filename,
            hires: true,
            includeContent: true
        }),
        scriptAst,
        scriptSetupAst
    };
}
function walkDeclaration(node, bindings, userImportAlias) {
    if (node.type === 'VariableDeclaration') {
        const isConst = node.kind === 'const';
        // export const foo = ...
        for (const { id, init } of node.declarations) {
            const isDefineCall = !!(isConst &&
                (isCallOf(init, DEFINE_PROPS) || isCallOf(init, DEFINE_EMIT)));
            if (id.type === 'Identifier') {
                let bindingType;
                if (
                // if a declaration is a const literal, we can mark it so that
                // the generated render fn code doesn't need to unref() it
                isDefineCall ||
                    (isConst &&
                        canNeverBeRef(init, userImportAlias['reactive'] || 'reactive'))) {
                    bindingType = "setup-const" /* SETUP_CONST */;
                }
                else if (isConst) {
                    if (isCallOf(init, userImportAlias['ref'] || 'ref')) {
                        bindingType = "setup-ref" /* SETUP_REF */;
                    }
                    else {
                        bindingType = "setup-maybe-ref" /* SETUP_MAYBE_REF */;
                    }
                }
                else {
                    bindingType = "setup-let" /* SETUP_LET */;
                }
                bindings[id.name] = bindingType;
            }
            else if (id.type === 'ObjectPattern') {
                walkObjectPattern(id, bindings, isConst, isDefineCall);
            }
            else if (id.type === 'ArrayPattern') {
                walkArrayPattern(id, bindings, isConst, isDefineCall);
            }
        }
    }
    else if (node.type === 'FunctionDeclaration' ||
        node.type === 'ClassDeclaration') {
        // export function foo() {} / export class Foo {}
        // export declarations must be named.
        bindings[node.id.name] = "setup-const" /* SETUP_CONST */;
    }
}
function walkObjectPattern(node, bindings, isConst, isDefineCall = false) {
    for (const p of node.properties) {
        if (p.type === 'ObjectProperty') {
            // key can only be Identifier in ObjectPattern
            if (p.key.type === 'Identifier') {
                if (p.key === p.value) {
                    // const { x } = ...
                    bindings[p.key.name] = isDefineCall
                        ? "setup-const" /* SETUP_CONST */
                        : isConst
                            ? "setup-maybe-ref" /* SETUP_MAYBE_REF */
                            : "setup-let" /* SETUP_LET */;
                }
                else {
                    walkPattern(p.value, bindings, isConst, isDefineCall);
                }
            }
        }
        else {
            // ...rest
            // argument can only be identifer when destructuring
            bindings[p.argument.name] = isConst
                ? "setup-const" /* SETUP_CONST */
                : "setup-let" /* SETUP_LET */;
        }
    }
}
function walkArrayPattern(node, bindings, isConst, isDefineCall = false) {
    for (const e of node.elements) {
        e && walkPattern(e, bindings, isConst, isDefineCall);
    }
}
function walkPattern(node, bindings, isConst, isDefineCall = false) {
    if (node.type === 'Identifier') {
        bindings[node.name] = isDefineCall
            ? "setup-const" /* SETUP_CONST */
            : isConst
                ? "setup-maybe-ref" /* SETUP_MAYBE_REF */
                : "setup-let" /* SETUP_LET */;
    }
    else if (node.type === 'RestElement') {
        // argument can only be identifer when destructuring
        bindings[node.argument.name] = isConst
            ? "setup-const" /* SETUP_CONST */
            : "setup-let" /* SETUP_LET */;
    }
    else if (node.type === 'ObjectPattern') {
        walkObjectPattern(node, bindings, isConst);
    }
    else if (node.type === 'ArrayPattern') {
        walkArrayPattern(node, bindings, isConst);
    }
    else if (node.type === 'AssignmentPattern') {
        if (node.left.type === 'Identifier') {
            bindings[node.left.name] = isDefineCall
                ? "setup-const" /* SETUP_CONST */
                : isConst
                    ? "setup-maybe-ref" /* SETUP_MAYBE_REF */
                    : "setup-let" /* SETUP_LET */;
        }
        else {
            walkPattern(node.left, bindings, isConst);
        }
    }
}
function recordType(node, declaredTypes) {
    if (node.type === 'TSInterfaceDeclaration') {
        declaredTypes[node.id.name] = [`Object`];
    }
    else if (node.type === 'TSTypeAliasDeclaration') {
        declaredTypes[node.id.name] = inferRuntimeType(node.typeAnnotation, declaredTypes);
    }
    else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        recordType(node.declaration, declaredTypes);
    }
}
function extractRuntimeProps(node, props, declaredTypes) {
    for (const m of node.members) {
        if (m.type === 'TSPropertySignature' && m.key.type === 'Identifier') {
            props[m.key.name] = {
                key: m.key.name,
                required: !m.optional,
                type:  m.typeAnnotation
                    ? inferRuntimeType(m.typeAnnotation.typeAnnotation, declaredTypes)
                    : [`null`]
            };
        }
    }
}
function inferRuntimeType(node, declaredTypes) {
    switch (node.type) {
        case 'TSStringKeyword':
            return ['String'];
        case 'TSNumberKeyword':
            return ['Number'];
        case 'TSBooleanKeyword':
            return ['Boolean'];
        case 'TSObjectKeyword':
            return ['Object'];
        case 'TSTypeLiteral':
            // TODO (nice to have) generate runtime property validation
            return ['Object'];
        case 'TSFunctionType':
            return ['Function'];
        case 'TSArrayType':
        case 'TSTupleType':
            // TODO (nice to have) generate runtime element type/length checks
            return ['Array'];
        case 'TSLiteralType':
            switch (node.literal.type) {
                case 'StringLiteral':
                    return ['String'];
                case 'BooleanLiteral':
                    return ['Boolean'];
                case 'NumericLiteral':
                case 'BigIntLiteral':
                    return ['Number'];
                default:
                    return [`null`];
            }
        case 'TSTypeReference':
            if (node.typeName.type === 'Identifier') {
                if (declaredTypes[node.typeName.name]) {
                    return declaredTypes[node.typeName.name];
                }
                switch (node.typeName.name) {
                    case 'Array':
                    case 'Function':
                    case 'Object':
                    case 'Set':
                    case 'Map':
                    case 'WeakSet':
                    case 'WeakMap':
                        return [node.typeName.name];
                    case 'Record':
                    case 'Partial':
                    case 'Readonly':
                    case 'Pick':
                    case 'Omit':
                    case 'Exclude':
                    case 'Extract':
                    case 'Required':
                    case 'InstanceType':
                        return ['Object'];
                }
            }
            return [`null`];
        case 'TSUnionType':
            return [
                ...new Set([].concat(node.types.map(t => inferRuntimeType(t, declaredTypes))))
            ];
        case 'TSIntersectionType':
            return ['Object'];
        default:
            return [`null`]; // no runtime check
    }
}
function genRuntimeProps(props) {
    const keys = Object.keys(props);
    if (!keys.length) {
        return ``;
    }
    return `\n  props: {\n    ${keys
        .map(key => {
        const { type, required } = props[key];
        return `${key}: { type: ${toRuntimeTypeString(type)}, required: ${required} }`;
    })
        .join(',\n    ')}\n  } as unknown as undefined,`;
}
function toRuntimeTypeString(types) {
    return types.some(t => t === 'null')
        ? `null`
        : types.length > 1
            ? `[${types.join(', ')}]`
            : types[0];
}
function extractRuntimeEmits(node, emits) {
    if (node.type === 'TSUnionType') {
        for (let t of node.types) {
            if (t.type === 'TSParenthesizedType')
                t = t.typeAnnotation;
            if (t.type === 'TSFunctionType') {
                extractRuntimeEmits(t, emits);
            }
        }
        return;
    }
    const eventName = node.parameters[0];
    if (eventName.type === 'Identifier' &&
        eventName.typeAnnotation &&
        eventName.typeAnnotation.type === 'TSTypeAnnotation') {
        const typeNode = eventName.typeAnnotation.typeAnnotation;
        if (typeNode.type === 'TSLiteralType') {
            emits.add(String(typeNode.literal.value));
        }
        else if (typeNode.type === 'TSUnionType') {
            for (const t of typeNode.types) {
                if (t.type === 'TSLiteralType') {
                    emits.add(String(t.literal.value));
                }
            }
        }
    }
}
function genRuntimeEmits(emits) {
    return emits.size
        ? `\n  emits: [${Array.from(emits)
            .map(p => JSON.stringify(p))
            .join(', ')}] as unknown as undefined,`
        : ``;
}
const parentStack = [];
/**
 * Walk an AST and find identifiers that are variable references.
 * This is largely the same logic with `transformExpressions` in compiler-core
 * but with some subtle differences as this needs to handle a wider range of
 * possible syntax.
 */
function walkIdentifiers(root, onIdentifier) {
    const knownIds = Object.create(null);
    estreeWalker.walk(root, {
        enter(node, parent) {
            parent && parentStack.push(parent);
            if (node.type === 'Identifier') {
                if (!knownIds[node.name] && isRefIdentifier(node, parent)) {
                    onIdentifier(node, parent);
                }
            }
            else if (isFunction$2(node)) {
                // walk function expressions and add its arguments to known identifiers
                // so that we don't prefix them
                node.params.forEach(p => estreeWalker.walk(p, {
                    enter(child, parent) {
                        if (child.type === 'Identifier' &&
                            // do not record as scope variable if is a destructured key
                            !isStaticPropertyKey$1(child, parent) &&
                            // do not record if this is a default value
                            // assignment of a destructured variable
                            !(parent &&
                                parent.type === 'AssignmentPattern' &&
                                parent.right === child)) {
                            const { name } = child;
                            if (node.scopeIds && node.scopeIds.has(name)) {
                                return;
                            }
                            if (name in knownIds) {
                                knownIds[name]++;
                            }
                            else {
                                knownIds[name] = 1;
                            }
                            (node.scopeIds || (node.scopeIds = new Set())).add(name);
                        }
                    }
                }));
            }
            else if (node.type === 'ObjectProperty' &&
                parent.type === 'ObjectPattern') {
                node.inPattern = true;
            }
        },
        leave(node, parent) {
            parent && parentStack.pop();
            if (node.scopeIds) {
                node.scopeIds.forEach((id) => {
                    knownIds[id]--;
                    if (knownIds[id] === 0) {
                        delete knownIds[id];
                    }
                });
            }
        }
    });
}
function isRefIdentifier(id, parent) {
    // declaration id
    if ((parent.type === 'VariableDeclarator' ||
        parent.type === 'ClassDeclaration') &&
        parent.id === id) {
        return false;
    }
    if (isFunction$2(parent)) {
        // function decalration/expression id
        if (parent.id === id) {
            return false;
        }
        // params list
        if (parent.params.includes(id)) {
            return false;
        }
    }
    // property key
    // this also covers object destructure pattern
    if (isStaticPropertyKey$1(id, parent)) {
        return false;
    }
    // non-assignment array destructure pattern
    if (parent.type === 'ArrayPattern' &&
        !isInDestructureAssignment$1(parent, parentStack)) {
        return false;
    }
    // member expression property
    if ((parent.type === 'MemberExpression' ||
        parent.type === 'OptionalMemberExpression') &&
        parent.property === id &&
        !parent.computed) {
        return false;
    }
    // is a special keyword but parsed as identifier
    if (id.name === 'arguments') {
        return false;
    }
    return true;
}
const isStaticProperty$1 = (node) => node &&
    (node.type === 'ObjectProperty' || node.type === 'ObjectMethod') &&
    !node.computed;
const isStaticPropertyKey$1 = (node, parent) => isStaticProperty$1(parent) && parent.key === node;
function isFunction$2(node) {
    return /Function(?:Expression|Declaration)$|Method$/.test(node.type);
}
function isCallOf(node, name) {
    return !!(node &&
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === name);
}
function canNeverBeRef(node, userReactiveImport) {
    if (isCallOf(node, userReactiveImport)) {
        return true;
    }
    switch (node.type) {
        case 'UnaryExpression':
        case 'BinaryExpression':
        case 'ArrayExpression':
        case 'ObjectExpression':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'UpdateExpression':
        case 'ClassExpression':
        case 'TaggedTemplateExpression':
            return true;
        case 'SequenceExpression':
            return canNeverBeRef(node.expressions[node.expressions.length - 1], userReactiveImport);
        default:
            if (node.type.endsWith('Literal')) {
                return true;
            }
            return false;
    }
}
function isInDestructureAssignment$1(parent, parentStack) {
    if (parent &&
        (parent.type === 'ObjectProperty' || parent.type === 'ArrayPattern')) {
        let i = parentStack.length;
        while (i--) {
            const p = parentStack[i];
            if (p.type === 'AssignmentExpression') {
                const root = parentStack[0];
                // if this is a ref: destructure, it should be treated like a
                // variable decalration!
                return !(root.type === 'LabeledStatement' && root.label.name === 'ref');
            }
            else if (p.type !== 'ObjectProperty' && !p.type.endsWith('Pattern')) {
                break;
            }
        }
    }
    return false;
}
/**
 * Analyze bindings in normal `<script>`
 * Note that `compileScriptSetup` already analyzes bindings as part of its
 * compilation process so this should only be used on single `<script>` SFCs.
 */
function analyzeScriptBindings(ast) {
    for (const node of ast) {
        if (node.type === 'ExportDefaultDeclaration' &&
            node.declaration.type === 'ObjectExpression') {
            return analyzeBindingsFromOptions(node.declaration);
        }
    }
    return {};
}
function analyzeBindingsFromOptions(node) {
    const bindings = {};
    for (const property of node.properties) {
        if (property.type === 'ObjectProperty' &&
            !property.computed &&
            property.key.type === 'Identifier') {
            // props
            if (property.key.name === 'props') {
                // props: ['foo']
                // props: { foo: ... }
                for (const key of getObjectOrArrayExpressionKeys(property.value)) {
                    bindings[key] = "props" /* PROPS */;
                }
            }
            // inject
            else if (property.key.name === 'inject') {
                // inject: ['foo']
                // inject: { foo: {} }
                for (const key of getObjectOrArrayExpressionKeys(property.value)) {
                    bindings[key] = "options" /* OPTIONS */;
                }
            }
            // computed & methods
            else if (property.value.type === 'ObjectExpression' &&
                (property.key.name === 'computed' || property.key.name === 'methods')) {
                // methods: { foo() {} }
                // computed: { foo() {} }
                for (const key of getObjectExpressionKeys(property.value)) {
                    bindings[key] = "options" /* OPTIONS */;
                }
            }
        }
        // setup & data
        else if (property.type === 'ObjectMethod' &&
            property.key.type === 'Identifier' &&
            (property.key.name === 'setup' || property.key.name === 'data')) {
            for (const bodyItem of property.body.body) {
                // setup() {
                //   return {
                //     foo: null
                //   }
                // }
                if (bodyItem.type === 'ReturnStatement' &&
                    bodyItem.argument &&
                    bodyItem.argument.type === 'ObjectExpression') {
                    for (const key of getObjectExpressionKeys(bodyItem.argument)) {
                        bindings[key] =
                            property.key.name === 'setup'
                                ? "setup-maybe-ref" /* SETUP_MAYBE_REF */
                                : "data" /* DATA */;
                    }
                }
            }
        }
    }
    return bindings;
}
function getObjectExpressionKeys(node) {
    const keys = [];
    for (const prop of node.properties) {
        if ((prop.type === 'ObjectProperty' || prop.type === 'ObjectMethod') &&
            !prop.computed) {
            if (prop.key.type === 'Identifier') {
                keys.push(prop.key.name);
            }
            else if (prop.key.type === 'StringLiteral') {
                keys.push(prop.key.value);
            }
        }
    }
    return keys;
}
function getArrayExpressionKeys(node) {
    const keys = [];
    for (const element of node.elements) {
        if (element && element.type === 'StringLiteral') {
            keys.push(element.value);
        }
    }
    return keys;
}
function getObjectOrArrayExpressionKeys(value) {
    if (value.type === 'ArrayExpression') {
        return getArrayExpressionKeys(value);
    }
    if (value.type === 'ObjectExpression') {
        return getObjectExpressionKeys(value);
    }
    return [];
}

exports.compileScript = compileScript;
exports.compileStyle = compileStyle;
exports.compileStyleAsync = compileStyleAsync;
exports.compileTemplate = compileTemplate;
exports.generateCodeFrame = generateCodeFrame;
exports.parse = parse$1;
exports.rewriteDefault = rewriteDefault;
