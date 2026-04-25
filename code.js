// ─── Token Mapper Plugin — code.js ───────────────────────────────────────────

figma.showUI(__html__, { width: 560, height: 720, title: "Token Mapper" });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMixed(val) { return typeof val === "symbol"; }

function safeArray(val) {
  if (!val || isMixed(val) || !Array.isArray(val)) return [];
  return val;
}

function safeNumber(val, fallback) {
  if (val === undefined || val === null || isMixed(val) || typeof val !== "number") return (fallback || 0);
  return val;
}

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
  if (!fn || isMixed(fn) || typeof fn !== "object") return null;
  if (!fn.family || typeof fn.family !== "string") return null;
  return fn;
}

function fontKey(node) {
  var fn     = getFontName(node);
  var family = fn ? fn.family : "";
  var style  = fn ? fn.style  : "";
  var size   = safeNumber(node.fontSize, 0);
  var lhVal  = 0;
  var lsVal  = 0;
  if (node.lineHeight && !isMixed(node.lineHeight) && node.lineHeight.value) {
    lhVal = Math.round(node.lineHeight.value * 10) / 10;
  }
  if (node.letterSpacing && !isMixed(node.letterSpacing) && node.letterSpacing.value) {
    lsVal = Math.round(node.letterSpacing.value * 10) / 10;
  }
  return [family, style, Math.round(size), lhVal, lsVal].join("|");
}

function safeId(val) {
  if (!val || isMixed(val) || typeof val === "symbol") return null;
  if (typeof val === "string") return val;
  return null;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

// ─── Scan ─────────────────────────────────────────────────────────────────────

function scanDocument() {
  var textGroups  = {};
  var colorGroups = {};
  var referencedTextStyleIds  = {};
  var referencedPaintStyleIds = {};
  var referencedVariableIds   = {};

  var allNodes;
  try { allNodes = figma.currentPage.findAll(); }
  catch(e) { allNodes = []; }

  for (var i = 0; i < allNodes.length; i++) {
    var node = allNodes[i];

    // ── Capture Variable References from the Node ──
    if (node.boundVariables) {
      if (node.boundVariables.fills) {
        for (var b = 0; b < node.boundVariables.fills.length; b++) {
          var alias = node.boundVariables.fills[b];
          if (alias && alias.type === "VARIABLE_ALIAS") referencedVariableIds[alias.id] = true;
        }
      }
      if (node.boundVariables.strokes) {
        for (var s = 0; s < node.boundVariables.strokes.length; s++) {
          var alias = node.boundVariables.strokes[s];
          if (alias && alias.type === "VARIABLE_ALIAS") referencedVariableIds[alias.id] = true;
        }
      }
    }

    // ── Text ─────────────────────────────────────────────────────────────────
    if (node.type === "TEXT") {
      try {
        var fn = getFontName(node);
        if (!fn) continue;

        var key = fontKey(node);
        if (!textGroups[key]) {
          var chars  = node.characters;
          var sample = (chars && typeof chars === "string") ? chars.slice(0, 40) : "";
          textGroups[key] = {
            id:            key,
            family:        fn.family,
            style:         fn.style || "Regular",
            size:          Math.round(safeNumber(node.fontSize, 0)),
            lineHeight:    (!isMixed(node.lineHeight))    ? node.lineHeight    : null,
            letterSpacing: (!isMixed(node.letterSpacing)) ? node.letterSpacing : null,
            sample:        sample,
            count:         0,
            nodeIds:       [],
          };
        }
        textGroups[key].count++;
        textGroups[key].nodeIds.push(node.id);

        var tsId = safeId(node.textStyleId);
        if (tsId) referencedTextStyleIds[tsId] = true;
      } catch(e) {}
    }

    // ── Fills ─────────────────────────────────────────────────────────────────
    var fills = safeArray(node.fills);
    for (var f = 0; f < fills.length; f++) {
      var fill = fills[f];
      if (!fill || fill.type !== "SOLID" || fill.visible === false) continue;
      try {
        var ck = colorKey(fill);
        if (!ck) continue;
        if (!colorGroups[ck]) {
          var fillOp = (fill.opacity !== undefined && !isMixed(fill.opacity)) ? fill.opacity : 1;
          colorGroups[ck] = {
            id:        ck,
            hex:       hexFromPaint(fill),
            opacity:   Math.round(fillOp * 100),
            count:     0,
            nodeIds:   [],
            nodeTypes: {},
            isStroke:  false,
          };
        }
        colorGroups[ck].count++;
        colorGroups[ck].nodeIds.push(node.id);
        colorGroups[ck].nodeTypes[node.type] = (colorGroups[ck].nodeTypes[node.type] || 0) + 1;

        var fsId = safeId(node.fillStyleId);
        if (fsId) referencedPaintStyleIds[fsId] = true;
      } catch(e) {}
    }

    // ── Strokes ───────────────────────────────────────────────────────────────
    var strokes = safeArray(node.strokes);
    for (var s = 0; s < strokes.length; s++) {
      var stroke = strokes[s];
      if (!stroke || stroke.type !== "SOLID" || stroke.visible === false) continue;
      try {
        var sk = "stroke_" + colorKey(stroke);
        if (!colorGroups[sk]) {
          var strokeOp = (stroke.opacity !== undefined && !isMixed(stroke.opacity)) ? stroke.opacity : 1;
          colorGroups[sk] = {
            id:        sk,
            hex:       hexFromPaint(stroke),
            opacity:   Math.round(strokeOp * 100),
            count:     0,
            nodeIds:   [],
            nodeTypes: { STROKE: 0 },
            isStroke:  true,
          };
        }
        colorGroups[sk].count++;
        colorGroups[sk].nodeIds.push(node.id);
        colorGroups[sk].nodeTypes["STROKE"] = (colorGroups[sk].nodeTypes["STROKE"] || 0) + 1;

        var ssId = safeId(node.strokeStyleId);
        if (ssId) referencedPaintStyleIds[ssId] = true;
      } catch(e) {}
    }
  }

  function byCount(a, b) { return b.count - a.count; }
  return {
    textGroups:              Object.values(textGroups).sort(byCount),
    colorGroups:             Object.values(colorGroups).sort(byCount),
    referencedTextStyleIds:  Object.keys(referencedTextStyleIds),
    referencedPaintStyleIds: Object.keys(referencedPaintStyleIds),
    referencedVariableIds:   Object.keys(referencedVariableIds),
  };
}

// ─── Load styles (local + library) via async APIs ────────────────────────────

async function loadStyles(referencedTextIds, referencedPaintIds, referencedVarIds) {
  referencedTextIds  = referencedTextIds  || [];
  referencedPaintIds = referencedPaintIds || [];
  referencedVarIds   = referencedVarIds   || [];

  var textStyleMap  = {};
  var paintStyleMap = {};
  var colorVarMap   = {};

  // ── Local text styles
  var localText = [];
  try { localText = await figma.getLocalTextStylesAsync(); } catch(e) { localText = []; }
  for (var i = 0; i < localText.length; i++) {
    var ts = localText[i];
    var fn = (ts.fontName && !isMixed(ts.fontName) && ts.fontName.family) ? ts.fontName : null;
    textStyleMap[ts.id] = {
      id:      ts.id,
      name:    ts.name || "Unnamed",
      family:  fn ? fn.family : "—",
      style:   fn ? fn.style  : "—",
      size:    ts.fontSize ? Math.round(ts.fontSize) : 0,
      isLocal: true,
    };
  }

  // ── Local paint styles
  var localPaint = [];
  try { localPaint = await figma.getLocalPaintStylesAsync(); } catch(e) { localPaint = []; }
  for (var p = 0; p < localPaint.length; p++) {
    var ps     = localPaint[p];
    var solid  = null;
    var paints = safeArray(ps.paints);
    for (var k = 0; k < paints.length; k++) {
      if (paints[k].type === "SOLID") { solid = paints[k]; break; }
    }
    var op = solid ? ((solid.opacity !== undefined && !isMixed(solid.opacity)) ? solid.opacity : 1) : 1;
    paintStyleMap[ps.id] = {
      id:      ps.id,
      name:    ps.name || "Unnamed",
      hex:     solid ? hexFromPaint(solid) : null,
      opacity: Math.round(op * 100),
      isLocal: true,
    };
  }

  // ── Local Color Variables
  var localVars = [];
  try { localVars = await figma.variables.getLocalVariablesAsync('COLOR'); } catch(e) {}
  for (var v = 0; v < localVars.length; v++) {
    var cv = localVars[v];
    colorVarMap[cv.id] = { id: cv.id, name: cv.name, isLocal: true };
  }

  // ── Library text styles
  for (var j = 0; j < referencedTextIds.length; j++) {
    var tid = referencedTextIds[j];
    if (textStyleMap[tid]) continue;
    try {
      var ls = await figma.getStyleByIdAsync(tid);
      if (!ls || ls.type !== "TEXT") continue;
      var lfn = (ls.fontName && !isMixed(ls.fontName) && ls.fontName.family) ? ls.fontName : null;
      textStyleMap[tid] = {
        id:      tid,
        name:    ls.name || "Unnamed",
        family:  lfn ? lfn.family : "—",
        style:   lfn ? lfn.style  : "—",
        size:    ls.fontSize ? Math.round(ls.fontSize) : 0,
        isLocal: false,
      };
    } catch(e) {}
  }

  // ── Library paint styles
  for (var q = 0; q < referencedPaintIds.length; q++) {
    var pid = referencedPaintIds[q];
    if (paintStyleMap[pid]) continue;
    try {
      var lps = await figma.getStyleByIdAsync(pid);
      if (!lps || lps.type !== "PAINT") continue;
      var lSolid  = null;
      var lPaints = safeArray(lps.paints);
      for (var m = 0; m < lPaints.length; m++) {
        if (lPaints[m].type === "SOLID") { lSolid = lPaints[m]; break; }
      }
      var lOp = lSolid ? ((lSolid.opacity !== undefined && !isMixed(lSolid.opacity)) ? lSolid.opacity : 1) : 1;
      paintStyleMap[pid] = {
        id:      pid,
        name:    lps.name || "Unnamed",
        hex:     lSolid ? hexFromPaint(lSolid) : null,
        opacity: Math.round(lOp * 100),
        isLocal: false,
      };
    } catch(e) {}
  }

  // ── Library Color Variables
  for (var z = 0; z < referencedVarIds.length; z++) {
    var vid = referencedVarIds[z];
    if (colorVarMap[vid]) continue;
    try {
      var libVar = await figma.variables.getVariableByIdAsync(vid);
      if (libVar && libVar.resolvedType === 'COLOR') {
        colorVarMap[vid] = { id: libVar.id, name: libVar.name, isLocal: false };
      }
    } catch(e) {}
  }

  function sortStyles(map) {
    return Object.values(map).sort(function(a, b) {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  return {
    textStyles:     sortStyles(textStyleMap),
    paintStyles:    sortStyles(paintStyleMap),
    colorVariables: sortStyles(colorVarMap),
  };
}

// ─── Apply text style ─────────────────────────────────────────────────────────
// ─── Apply text style ─────────────────────────────────────────────────────────

async function applyTextStyle(nodeIds, styleId) {
  try {
    var style = await figma.getStyleByIdAsync(styleId);
    if (!style) return { ok: false, error: "Style not found in document" };

    // 1. Load the target style's font first
    if (style.fontName && style.fontName.family) {
      await figma.loadFontAsync(style.fontName);
    }

    var applied = 0;
    var lastError = null;

    for (var i = 0; i < nodeIds.length; i++) {
      try {
        var node = await figma.getNodeByIdAsync(nodeIds[i]);
        if (!node || node.type !== "TEXT") continue;

        // 2. Figma completely blocks style changes if the layer has a missing font
        if (node.hasMissingFont) {
          lastError = "Missing fonts detected. Replace them in Figma first.";
          console.warn("Skipped node", node.id, "- User is missing the required font.");
          continue; 
        }

        // 3. Load ALL fonts currently used inside the text node (required by Figma)
        if (node.characters.length > 0) {
          var currentFonts = node.getRangeAllFontNames(0, node.characters.length);
          for (var f = 0; f < currentFonts.length; f++) {
            await figma.loadFontAsync(currentFonts[f]);
          }
        } else if (node.fontName && node.fontName !== figma.mixed) {
          // Fallback for empty text nodes
          await figma.loadFontAsync(node.fontName);
        }

        // 4. Safely apply the style
        node.textStyleId = styleId;
        applied++;

      } catch(e) {
        console.warn("applyTextStyle failed on node " + nodeIds[i] + ":", String(e));
        lastError = "Font load error. Check Figma console.";
      }
    }

    // If nothing applied, pass the specific error to the UI toast
    if (applied === 0 && lastError) {
      return { ok: false, error: lastError };
    }

    return { ok: true, applied: applied };

  } catch (err) {
    console.error("Critical text style error:", String(err));
    return { ok: false, error: String(err) };
  }
}

// ─── Apply paint style ────────────────────────────────────────────────────────

async function applyPaintStyle(nodeIds, styleId, isStroke) {
  var style = await figma.getStyleByIdAsync(styleId);
  if (!style) return { ok: false, error: "Style not found" };

  var applied = 0;
  for (var i = 0; i < nodeIds.length; i++) {
    try {
      var node = await figma.getNodeByIdAsync(nodeIds[i]);
      if (!node) continue;
      if (isStroke && "strokeStyleId" in node) {
        node.strokeStyleId = styleId;
        applied++;
      } else if (!isStroke && "fillStyleId" in node) {
        node.fillStyleId = styleId;
        applied++;
      }
    } catch(e) {
      console.warn("applyPaintStyle failed:", String(e));
    }
  }
  return { ok: true, applied: applied };
}

// ─── Apply Variables ────────────────────────────────────────────────────────

async function applyColorVariable(nodeIds, variableId, isStroke) {
  var variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) return { ok: false, error: "Variable not found" };

  var applied = 0;
  for (var i = 0; i < nodeIds.length; i++) {
    try {
      var node = await figma.getNodeByIdAsync(nodeIds[i]);
      if (!node) continue;

      if (isStroke && "strokes" in node) {
        var strokes = [...node.strokes];
        var changed = false;
        for(var s=0; s<strokes.length; s++) {
          if(strokes[s].type === 'SOLID' || strokes[s].type === 'VARIABLE_ALIAS') {
            strokes[s] = figma.variables.setBoundVariableForPaint(strokes[s], 'color', variable);
            changed = true;
          }
        }
        if(changed) { node.strokes = strokes; applied++; }
        
      } else if (!isStroke && "fills" in node) {
        var fills = [...node.fills];
        var changedFills = false;
        for(var f=0; f<fills.length; f++) {
          if(fills[f].type === 'SOLID' || fills[f].type === 'VARIABLE_ALIAS') {
            fills[f] = figma.variables.setBoundVariableForPaint(fills[f], 'color', variable);
            changedFills = true;
          }
        }
        if(changedFills) { node.fills = fills; applied++; }
      }
    } catch(e) {
      console.warn("applyColorVariable failed:", String(e));
    }
  }
  return { ok: true, applied: applied };
}


// ─── Select nodes ─────────────────────────────────────────────────────────────

async function selectNodes(nodeIds) {
  var nodes = [];
  for (var i = 0; i < nodeIds.length; i++) {
    try {
      var n = await figma.getNodeByIdAsync(nodeIds[i]);
      if (n) nodes.push(n);
    } catch(e) {}
  }
  figma.currentPage.selection = nodes;
  if (nodes.length > 0) figma.viewport.scrollAndZoomIntoView(nodes);
}

// ─── Message router ───────────────────────────────────────────────────────────

figma.ui.onmessage = async function(msg) {
  try {
    if (msg.type === "SCAN") {
      figma.ui.postMessage({ type: "SCAN_START" });
      var scan   = scanDocument();
      var styles = await loadStyles(scan.referencedTextStyleIds, scan.referencedPaintStyleIds, scan.referencedVariableIds);
      figma.ui.postMessage({
        type:           "SCAN_RESULT",
        textGroups:     scan.textGroups,
        colorGroups:    scan.colorGroups,
        textStyles:     styles.textStyles,
        paintStyles:    styles.paintStyles,
        colorVariables: styles.colorVariables,
      });

    } else if (msg.type === "APPLY_TEXT_STYLE") {
      var r1 = await applyTextStyle(msg.nodeIds, msg.styleId);
      figma.ui.postMessage({ type: "APPLY_RESULT", ok: r1.ok, applied: r1.applied, error: r1.error, target: "text" });

    } else if (msg.type === "APPLY_PAINT_STYLE") {
      var r2 = await applyPaintStyle(msg.nodeIds, msg.styleId, msg.isStroke);
      figma.ui.postMessage({ type: "APPLY_RESULT", ok: r2.ok, applied: r2.applied, error: r2.error, target: "color" });
      
    } else if (msg.type === "APPLY_VARIABLE") {
      var r3 = await applyColorVariable(msg.nodeIds, msg.variableId, msg.isStroke);
      figma.ui.postMessage({ type: "APPLY_RESULT", ok: r3.ok, applied: r3.applied, error: r3.error, target: "color" });

    } else if (msg.type === "SELECT_NODES") {
      await selectNodes(msg.nodeIds);

    } else if (msg.type === "REFRESH_STYLES") {
      var rs   = scanDocument();
      var rsty = await loadStyles(rs.referencedTextStyleIds, rs.referencedPaintStyleIds, rs.referencedVariableIds);
      figma.ui.postMessage({ 
        type: "STYLES_REFRESHED", 
        textStyles: rsty.textStyles, 
        paintStyles: rsty.paintStyles,
        colorVariables: rsty.colorVariables
      });

    } else if (msg.type === "CLOSE") {
      figma.closePlugin();
    }

  } catch(e) {
    console.error("Plugin error:", String(e));
    figma.ui.postMessage({ type: "APPLY_RESULT", ok: false, error: String(e), applied: 0, target: "unknown" });
  }
};