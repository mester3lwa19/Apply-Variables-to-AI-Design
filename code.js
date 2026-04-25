// ─── Token Mapper Plugin — code.js ───────────────────────────────────────────

figma.showUI(__html__, { width: 560, height: 1200, title: "Token Mapper" });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMixed(val) { return typeof val === "symbol"; }
function safeArray(val) { return (!val || isMixed(val) || !Array.isArray(val)) ? [] : val; }
function safeNumber(val, fallback) { return (val === undefined || val === null || isMixed(val) || typeof val !== "number") ? (fallback || 0) : val; }

function rgbToHex(color) {
  function toHex(v) { return Math.round(v * 255).toString(16).padStart(2, "0"); }
  return ("#" + toHex(color.r) + toHex(color.g) + toHex(color.b)).toUpperCase();
}

function colorKey(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  var opacity = (paint.opacity !== undefined && !isMixed(paint.opacity)) ? paint.opacity : 1;
  return rgbToHex(paint.color) + "_" + Math.round(opacity * 100);
}

function hexFromPaint(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  return rgbToHex(paint.color);
}

function getFontName(node) {
  var fn = node.fontName;
  return (!fn || isMixed(fn) || typeof fn !== "object" || !fn.family || typeof fn.family !== "string") ? null : fn;
}

function fontKey(node) {
  var fn = getFontName(node);
  var family = fn ? fn.family : "";
  var style  = fn ? fn.style  : "";
  var size   = safeNumber(node.fontSize, 0);
  var lhVal  = (node.lineHeight && !isMixed(node.lineHeight) && node.lineHeight.value) ? Math.round(node.lineHeight.value * 10) / 10 : 0;
  var lsVal  = (node.letterSpacing && !isMixed(node.letterSpacing) && node.letterSpacing.value) ? Math.round(node.letterSpacing.value * 10) / 10 : 0;
  return [family, style, Math.round(size), lhVal, lsVal].join("|");
}

function safeId(val) { return (!val || isMixed(val) || typeof val === "symbol") ? null : (typeof val === "string" ? val : null); }

// ─── Sync Library Logic ──────────────────────────────────────────────────────

async function getSyncOptions() {
  try {
    var localText = await figma.getLocalTextStylesAsync();
    var localPaint = await figma.getLocalPaintStylesAsync();
    var collections = await figma.variables.getLocalVariableCollectionsAsync();

    return {
      hasText: localText.length > 0,
      hasPaint: localPaint.length > 0,
      collections: collections.map(c => ({ id: c.id, name: c.name }))
    };
  } catch(e) {
    return { hasText: false, hasPaint: false, collections: [] };
  }
}

async function syncLibraryToCache(options) {
  var textCache = [];
  var paintCache = [];
  var varCache = [];

  try {
    if (options.syncText) {
      var localText = await figma.getLocalTextStylesAsync();
      for (var i = 0; i < localText.length; i++) {
        var ts = localText[i];
        if (ts.fontName && !isMixed(ts.fontName) && ts.fontName.family) {
          textCache.push({ name: ts.name, key: ts.key, family: ts.fontName.family, style: ts.fontName.style, size: ts.fontSize ? Math.round(ts.fontSize) : 0 });
        }
      }
    }
    
    if (options.syncPaint) {
      var localPaint = await figma.getLocalPaintStylesAsync();
      for (var p = 0; p < localPaint.length; p++) {
        var ps = localPaint[p];
        var solid = null;
        var paints = safeArray(ps.paints);
        for (var k = 0; k < paints.length; k++) { if (paints[k].type === "SOLID") { solid = paints[k]; break; } }
        if (solid) {
          var op = (solid.opacity !== undefined && !isMixed(solid.opacity)) ? solid.opacity : 1;
          paintCache.push({ name: ps.name, key: ps.key, hex: hexFromPaint(solid), opacity: Math.round(op * 100) });
        }
      }
    }

    if (options.collectionIds && options.collectionIds.length > 0) {
      var localVars = await figma.variables.getLocalVariablesAsync('COLOR');
      for (var v = 0; v < localVars.length; v++) {
        if (options.collectionIds.includes(localVars[v].variableCollectionId)) {
          varCache.push({ name: localVars[v].name, key: localVars[v].key });
        }
      }
    }

    await figma.clientStorage.setAsync('token_mapper_sync', { textStyles: textCache, paintStyles: paintCache, colorVariables: varCache });
    return { ok: true, count: textCache.length + paintCache.length + varCache.length };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Scan Document ───────────────────────────────────────────────────────────

function scanDocument() {
  var textGroups = {}, colorGroups = {}, referencedTextStyleIds = {}, referencedPaintStyleIds = {}, referencedVariableIds = {};
  var allNodes = [];
  var selection = figma.currentPage.selection;
  
  if (selection.length > 0) {
    for (var n = 0; n < selection.length; n++) {
      allNodes.push(selection[n]);
      if ("findAll" in selection[n]) allNodes = allNodes.concat(selection[n].findAll());
    }
  } else {
    try { allNodes = figma.currentPage.findAll(); } catch(e) { allNodes = []; }
  }

  for (var i = 0; i < allNodes.length; i++) {
    var node = allNodes[i];

    if (node.boundVariables) {
      if (node.boundVariables.fills) {
        for (var b = 0; b < node.boundVariables.fills.length; b++) {
          if (node.boundVariables.fills[b] && node.boundVariables.fills[b].type === "VARIABLE_ALIAS") referencedVariableIds[node.boundVariables.fills[b].id] = true;
        }
      }
      if (node.boundVariables.strokes) {
        for (var s = 0; s < node.boundVariables.strokes.length; s++) {
          if (node.boundVariables.strokes[s] && node.boundVariables.strokes[s].type === "VARIABLE_ALIAS") referencedVariableIds[node.boundVariables.strokes[s].id] = true;
        }
      }
    }

    if (node.type === "TEXT") {
      try {
        var fn = getFontName(node);
        if (fn) {
          var key = fontKey(node);
          if (!textGroups[key]) {
            var chars = node.characters;
            textGroups[key] = {
              id: key, family: fn.family, style: fn.style || "Regular", size: Math.round(safeNumber(node.fontSize, 0)),
              lineHeight: (!isMixed(node.lineHeight)) ? node.lineHeight : null, letterSpacing: (!isMixed(node.letterSpacing)) ? node.letterSpacing : null,
              sample: (chars && typeof chars === "string") ? chars.slice(0, 40) : "", count: 0, nodeIds: [], existingStyleId: null
            };
          }
          textGroups[key].count++;
          textGroups[key].nodeIds.push(node.id);
          var tsId = safeId(node.textStyleId);
          if (tsId) { referencedTextStyleIds[tsId] = true; textGroups[key].existingStyleId = tsId; }
        }
      } catch(e) {}
    }

    var fills = safeArray(node.fills);
    for (var f = 0; f < fills.length; f++) {
      if (!fills[f] || fills[f].type !== "SOLID" || fills[f].visible === false) continue;
      try {
        var ck = colorKey(fills[f]);
        if (ck) {
          var boundVarId = (fills[f].boundVariables && fills[f].boundVariables.color && fills[f].boundVariables.color.type === "VARIABLE_ALIAS") ? fills[f].boundVariables.color.id : null;
          var fsId = safeId(node.fillStyleId);
          if (!colorGroups[ck]) {
            var fillOp = (fills[f].opacity !== undefined && !isMixed(fills[f].opacity)) ? fills[f].opacity : 1;
            colorGroups[ck] = { id: ck, hex: hexFromPaint(fills[f]), opacity: Math.round(fillOp * 100), count: 0, nodeIds: [], nodeTypes: {}, isStroke: false, existingVarId: null, existingStyleId: null };
          }
          colorGroups[ck].count++;
          colorGroups[ck].nodeIds.push(node.id);
          colorGroups[ck].nodeTypes[node.type] = (colorGroups[ck].nodeTypes[node.type] || 0) + 1;
          if (boundVarId) { referencedVariableIds[boundVarId] = true; colorGroups[ck].existingVarId = boundVarId; }
          else if (fsId) { referencedPaintStyleIds[fsId] = true; colorGroups[ck].existingStyleId = fsId; }
        }
      } catch(e) {}
    }

    var strokes = safeArray(node.strokes);
    for (var st = 0; st < strokes.length; st++) {
      if (!strokes[st] || strokes[st].type !== "SOLID" || strokes[st].visible === false) continue;
      try {
        var sk = "stroke_" + colorKey(strokes[st]);
        var boundVarIdStroke = (strokes[st].boundVariables && strokes[st].boundVariables.color && strokes[st].boundVariables.color.type === "VARIABLE_ALIAS") ? strokes[st].boundVariables.color.id : null;
        var ssId = safeId(node.strokeStyleId);
        if (!colorGroups[sk]) {
          var strokeOp = (strokes[st].opacity !== undefined && !isMixed(strokes[st].opacity)) ? strokes[st].opacity : 1;
          colorGroups[sk] = { id: sk, hex: hexFromPaint(strokes[st]), opacity: Math.round(strokeOp * 100), count: 0, nodeIds: [], nodeTypes: { STROKE: 0 }, isStroke: true, existingVarId: null, existingStyleId: null };
        }
        colorGroups[sk].count++;
        colorGroups[sk].nodeIds.push(node.id);
        colorGroups[sk].nodeTypes["STROKE"] = (colorGroups[sk].nodeTypes["STROKE"] || 0) + 1;
        if (boundVarIdStroke) { referencedVariableIds[boundVarIdStroke] = true; colorGroups[sk].existingVarId = boundVarIdStroke; }
        else if (ssId) { referencedPaintStyleIds[ssId] = true; colorGroups[sk].existingStyleId = ssId; }
      } catch(e) {}
    }
  }

  return {
    textGroups: Object.values(textGroups).sort((a,b)=>b.count-a.count),
    colorGroups: Object.values(colorGroups).sort((a,b)=>b.count-a.count),
    referencedTextStyleIds: Object.keys(referencedTextStyleIds),
    referencedPaintStyleIds: Object.keys(referencedPaintStyleIds),
    referencedVariableIds: Object.keys(referencedVariableIds),
  };
}

// ─── Load styles (local + active + cached) ───────────────────────────────────

async function loadStyles(referencedTextIds, referencedPaintIds, referencedVarIds) {
  var textStyleMap = {}, paintStyleMap = {}, colorVarMap = {};

  try { var localText = await figma.getLocalTextStylesAsync(); localText.forEach(s => { var fn = (s.fontName && !isMixed(s.fontName) && s.fontName.family) ? s.fontName : null; textStyleMap[s.id] = { id: s.id, name: s.name || "Unnamed", family: fn ? fn.family : "—", style: fn ? fn.style : "—", size: s.fontSize ? Math.round(s.fontSize) : 0, isLocal: true, isCached: false }; }); } catch(e) {}
  try { var localPaint = await figma.getLocalPaintStylesAsync(); localPaint.forEach(ps => { var solid = safeArray(ps.paints).find(x=>x.type==="SOLID"); var op = solid ? ((solid.opacity !== undefined && !isMixed(solid.opacity)) ? solid.opacity : 1) : 1; paintStyleMap[ps.id] = { id: ps.id, name: ps.name || "Unnamed", hex: solid ? hexFromPaint(solid) : null, opacity: Math.round(op * 100), isLocal: true, isCached: false }; }); } catch(e) {}
  try { var localVars = await figma.variables.getLocalVariablesAsync('COLOR'); localVars.forEach(cv => { colorVarMap[cv.id] = { id: cv.id, name: cv.name, isLocal: true, isCached: false }; }); } catch(e) {}

  for (var j = 0; j < (referencedTextIds||[]).length; j++) { if (!textStyleMap[referencedTextIds[j]]) { try { var ls = await figma.getStyleByIdAsync(referencedTextIds[j]); if (ls && ls.type === "TEXT") { var lfn = (ls.fontName && !isMixed(ls.fontName) && ls.fontName.family) ? ls.fontName : null; textStyleMap[ls.id] = { id: ls.id, name: ls.name || "Unnamed", family: lfn ? lfn.family : "—", style: lfn ? lfn.style : "—", size: ls.fontSize ? Math.round(ls.fontSize) : 0, isLocal: false, isCached: false }; } } catch(e) {} } }
  for (var q = 0; q < (referencedPaintIds||[]).length; q++) { if (!paintStyleMap[referencedPaintIds[q]]) { try { var lps = await figma.getStyleByIdAsync(referencedPaintIds[q]); if (lps && lps.type === "PAINT") { var lSolid = safeArray(lps.paints).find(x=>x.type==="SOLID"); var lOp = lSolid ? ((lSolid.opacity !== undefined && !isMixed(lSolid.opacity)) ? lSolid.opacity : 1) : 1; paintStyleMap[lps.id] = { id: lps.id, name: lps.name || "Unnamed", hex: lSolid ? hexFromPaint(lSolid) : null, opacity: Math.round(lOp * 100), isLocal: false, isCached: false }; } } catch(e) {} } }
  for (var z = 0; z < (referencedVarIds||[]).length; z++) { if (!colorVarMap[referencedVarIds[z]]) { try { var libVar = await figma.variables.getVariableByIdAsync(referencedVarIds[z]); if (libVar && libVar.resolvedType === 'COLOR') { colorVarMap[libVar.id] = { id: libVar.id, name: libVar.name, isLocal: false, isCached: false }; } } catch(e) {} } }

  var cachedData = { textStyles: [], paintStyles: [], colorVariables: [] };
  try { cachedData = await figma.clientStorage.getAsync('token_mapper_sync') || cachedData; } catch(e) {}
  
  cachedData.textStyles.forEach(c => { textStyleMap['cached_' + c.key] = { id: c.key, name: c.name, family: c.family, style: c.style, size: c.size, isLocal: false, isCached: true }; });
  cachedData.paintStyles.forEach(c => { paintStyleMap['cached_' + c.key] = { id: c.key, name: c.name, hex: c.hex, opacity: c.opacity, isLocal: false, isCached: true }; });
  cachedData.colorVariables.forEach(c => { colorVarMap['cached_' + c.key] = { id: c.key, name: c.name, isLocal: false, isCached: true }; });

  function sortStyles(map) {
    return Object.values(map).sort(function(a, b) {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      if (a.isCached !== b.isCached) return a.isCached ? 1 : -1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  return { textStyles: sortStyles(textStyleMap), paintStyles: sortStyles(paintStyleMap), colorVariables: sortStyles(colorVarMap) };
}

// ─── Apply target logic ───────────────────────────────────────────────────────

async function getOrImportStyle(payload, isPaint) {
  if (payload.isCached) {
    try { return await figma.importStyleByKeyAsync(payload.id); } catch(e) { throw new Error("Cannot import library style. Ensure the library is published."); }
  } else {
    var style = await figma.getStyleByIdAsync(payload.id);
    if (!style) throw new Error("Style not found in document.");
    return style;
  }
}

async function getOrImportVariable(payload) {
  if (payload.isCached) {
    try { return await figma.variables.importVariableByKeyAsync(payload.id); } catch(e) { throw new Error("Cannot import library variable. Ensure the library is published."); }
  } else {
    var variable = await figma.variables.getVariableByIdAsync(payload.id);
    if (!variable) throw new Error("Variable not found in document.");
    return variable;
  }
}

async function applyTextStyle(nodeIds, payload) {
  try {
    var style = await getOrImportStyle(payload, false);
    if (style.fontName && style.fontName.family) {
      try { await figma.loadFontAsync(style.fontName); } catch (err) { return { ok: false, error: "Missing Target Font: " + style.fontName.family + " " + style.fontName.style }; }
    }

    var applied = 0, lastError = null;
    for (var i = 0; i < nodeIds.length; i++) {
      try {
        var node = await figma.getNodeByIdAsync(nodeIds[i]);
        if (!node || node.type !== "TEXT") continue;
        if (node.hasMissingFont) { lastError = "Layer has a missing font: " + node.name; continue; }

        var fontsToLoad = [];
        if (node.fontName && node.fontName !== figma.mixed) fontsToLoad.push(node.fontName);
        else if (node.characters.length > 0) fontsToLoad = fontsToLoad.concat(node.getRangeAllFontNames(0, node.characters.length));

        for (var f = 0; f < fontsToLoad.length; f++) {
          try { await figma.loadFontAsync(fontsToLoad[f]); } catch (err) { throw new Error("Cannot load: " + fontsToLoad[f].family + " " + fontsToLoad[f].style); }
        }

        if ("setTextStyleIdAsync" in node) await node.setTextStyleIdAsync(style.id);
        else node.textStyleId = style.id;
        applied++;
      } catch(e) { lastError = e.message || String(e); }
    }
    return (applied === 0 && lastError) ? { ok: false, error: lastError } : { ok: true, applied: applied };
  } catch (err) { return { ok: false, error: err.message || String(err) }; }
}

async function applyPaintStyle(nodeIds, payload, isStroke) {
  try {
    var style = await getOrImportStyle(payload, true);
    var applied = 0;
    for (var i = 0; i < nodeIds.length; i++) {
      try {
        var node = await figma.getNodeByIdAsync(nodeIds[i]);
        if (!node) continue;
        if (isStroke && "setStrokeStyleIdAsync" in node) { await node.setStrokeStyleIdAsync(style.id); applied++; }
        else if (!isStroke && "setFillStyleIdAsync" in node) { await node.setFillStyleIdAsync(style.id); applied++; }
        else {
          if (isStroke && "strokeStyleId" in node) { node.strokeStyleId = style.id; applied++; }
          else if (!isStroke && "fillStyleId" in node) { node.fillStyleId = style.id; applied++; }
        }
      } catch(e) {}
    }
    return { ok: true, applied: applied };
  } catch (err) { return { ok: false, error: err.message || String(err) }; }
}

async function applyColorVariable(nodeIds, payload, isStroke) {
  try {
    var variable = await getOrImportVariable(payload);
    var applied = 0;
    for (var i = 0; i < nodeIds.length; i++) {
      try {
        var node = await figma.getNodeByIdAsync(nodeIds[i]);
        if (!node) continue;
        if (isStroke && "strokes" in node) {
          var strokes = [...node.strokes], changed = false;
          for(var s=0; s<strokes.length; s++) {
            if(strokes[s].type === 'SOLID' || strokes[s].type === 'VARIABLE_ALIAS') { strokes[s] = figma.variables.setBoundVariableForPaint(strokes[s], 'color', variable); changed = true; }
          }
          if(changed) { node.strokes = strokes; applied++; }
        } else if (!isStroke && "fills" in node) {
          var fills = [...node.fills], changedFills = false;
          for(var f=0; f<fills.length; f++) {
            if(fills[f].type === 'SOLID' || fills[f].type === 'VARIABLE_ALIAS') { fills[f] = figma.variables.setBoundVariableForPaint(fills[f], 'color', variable); changedFills = true; }
          }
          if(changedFills) { node.fills = fills; applied++; }
        }
      } catch(e) {}
    }
    return { ok: true, applied: applied };
  } catch (err) { return { ok: false, error: err.message || String(err) }; }
}

async function selectNodes(nodeIds) {
  var nodes = [];
  for (var i = 0; i < nodeIds.length; i++) { try { var n = await figma.getNodeByIdAsync(nodeIds[i]); if (n) nodes.push(n); } catch(e) {} }
  figma.currentPage.selection = nodes;
  if (nodes.length > 0) figma.viewport.scrollAndZoomIntoView(nodes);
}

// ─── Message router ───────────────────────────────────────────────────────────

figma.ui.onmessage = async function(msg) {
  try {
    if (msg.type === "GET_SYNC_OPTIONS") {
      var options = await getSyncOptions();
      figma.ui.postMessage({ type: "SYNC_OPTIONS_RESULT", options: options });

    } else if (msg.type === "SYNC") {
      figma.ui.postMessage({ type: "SCAN_START" }); // Re-use loading UI
      var rSync = await syncLibraryToCache(msg.options);
      figma.ui.postMessage({ type: "SYNC_RESULT", ok: rSync.ok, count: rSync.count, error: rSync.error });
      
    } else if (msg.type === "SCAN" || msg.type === "REFRESH_STYLES") {
      if (msg.type === "SCAN") figma.ui.postMessage({ type: "SCAN_START" });
      var scan = scanDocument();
      var styles = await loadStyles(scan.referencedTextStyleIds, scan.referencedPaintStyleIds, scan.referencedVariableIds);
      figma.ui.postMessage({
        type: msg.type === "SCAN" ? "SCAN_RESULT" : "STYLES_REFRESHED",
        textGroups: scan.textGroups, colorGroups: scan.colorGroups,
        textStyles: styles.textStyles, paintStyles: styles.paintStyles, colorVariables: styles.colorVariables,
      });

    } else if (msg.type === "APPLY_TEXT_STYLE") {
      var r1 = await applyTextStyle(msg.nodeIds, msg.payload);
      figma.ui.postMessage({ type: "APPLY_RESULT", ok: r1.ok, applied: r1.applied, error: r1.error });

    } else if (msg.type === "APPLY_PAINT_STYLE") {
      var r2 = await applyPaintStyle(msg.nodeIds, msg.payload, msg.isStroke);
      figma.ui.postMessage({ type: "APPLY_RESULT", ok: r2.ok, applied: r2.applied, error: r2.error });
      
    } else if (msg.type === "APPLY_VARIABLE") {
      var r3 = await applyColorVariable(msg.nodeIds, msg.payload, msg.isStroke);
      figma.ui.postMessage({ type: "APPLY_RESULT", ok: r3.ok, applied: r3.applied, error: r3.error });

    } else if (msg.type === "SELECT_NODES") {
      await selectNodes(msg.nodeIds);
    } else if (msg.type === "CLOSE") {
      figma.closePlugin();
    }
  } catch(e) {
    console.error("Plugin error:", String(e));
    figma.ui.postMessage({ type: "APPLY_RESULT", ok: false, error: String(e), applied: 0 });
  }
};