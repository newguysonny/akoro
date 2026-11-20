import { Icon } from '../../../components/common/Icons.jsx';
import { FONTS, FONT_SIZES, LINE_SPACINGS, STYLES, PAGE_SIZES, MARGINS, DEFAULT_FONT } from '../../../lib/wordDoc.js';
import { WORD_BLUE, RIBBON_BG, LINE, TXT, SUB, UI_FONT, COLORS, HIGHLIGHTS, SYMBOLS, fontCss } from './wordEditorTokens.js';
import { Btn, Group, Drop, MenuItem, Swatches, Col, Row, CARET_BTN } from './wordEditorParts.jsx';

export default function WordEditorToolbar({ wd }) {
  const {
    editor, open, setOpen, c, lastMark, setLastMark, lastColor, setLastColor,
    curFont, curSize, curLine, curStyle, setStyle, stepSize, clip,
    picRef, insertPicture, changePage, page, save, saving, fileName, words, pages,
    view, setView, ruler, setRuler, zoom, setZoom, canvasRef, box,
    tab, setTab, collapsed, setCollapsed, tabs, find, setFind, findNext, matches, replaceAll,
    err, setErr, linkUrl, setLinkUrl, onDownload,
  } = wd;

  /* ── Ribbons ── */
  const home = (
    <>
      <Group label="Undo">
        <Col>
          <Btn icon="ti-arrow-back-up" label="Undo (Ctrl+Z)" onClick={() => c().undo().run()} disabled={!editor.can().undo()}/>
          <Btn icon="ti-arrow-forward-up" label="Redo (Ctrl+Y)" onClick={() => c().redo().run()} disabled={!editor.can().redo()}/>
        </Col>
      </Group>
      <Group label="Clipboard">
        <Btn big icon="ti-clipboard" text="Paste" label="Paste (Ctrl+V)" onClick={() => clip('paste')}/>
        <Col>
          <Btn icon="ti-scissors" label="Cut (Ctrl+X)" onClick={() => clip('cut')}/>
          <Btn icon="ti-copy" label="Copy (Ctrl+C)" onClick={() => clip('copy')}/>
        </Col>
      </Group>
      <Group label="Font">
        <Col>
          <Row>
            <select aria-label="Font" value={curFont} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => c().setFontFamily(fontCss(e.target.value)).run()}
              style={{ width: 128, height: 24, border: `1px solid #C8C8C8`, borderRadius: 2, fontSize: 12, fontFamily: UI_FONT, background: '#fff', color: TXT }}>
              {FONTS.map((f) => <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>{f.name}</option>)}
            </select>
            <select aria-label="Font size" value={String(curSize)} onChange={(e) => c().setFontSize(`${e.target.value}pt`).run()}
              style={{ width: 52, height: 24, marginLeft: 3, border: `1px solid #C8C8C8`, borderRadius: 2, fontSize: 12, fontFamily: UI_FONT, background: '#fff', color: TXT }}>
              {[...new Set([...FONT_SIZES, curSize])].sort((a, b) => a - b).map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
            <Btn icon="ti-text-increase" label="Grow font" onClick={() => stepSize(1)}/>
            <Btn icon="ti-text-decrease" label="Shrink font" onClick={() => stepSize(-1)}/>
            <Btn icon="ti-clear-formatting" label="Clear all formatting" onClick={() => c().unsetAllMarks().setParagraph().run()}/>
          </Row>
          <Row>
            <Btn icon="ti-bold" label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}/>
            <Btn icon="ti-italic" label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}/>
            <Btn icon="ti-underline" label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}/>
            <Btn icon="ti-strikethrough" label="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}/>
            <Btn icon="ti-subscript" label="Subscript" active={editor.isActive('subscript')} onClick={() => c().toggleSubscript().run()}/>
            <Btn icon="ti-superscript" label="Superscript" active={editor.isActive('superscript')} onClick={() => c().toggleSuperscript().run()}/>
            <Drop open={open} setOpen={setOpen} id="mark" button={(toggle) => (
              <span style={{ display: 'inline-flex' }}>
                <Btn icon="ti-highlight" bar={lastMark} label="Text highlight colour" onClick={() => c().toggleHighlight({ color: lastMark }).run()}/>
                <button type="button" aria-label="Highlight colours" onMouseDown={(e) => e.preventDefault()} onClick={toggle} style={CARET_BTN}><Icon name="ti-chevron-down" size={10}/></button>
              </span>
            )}>
              <Swatches colors={HIGHLIGHTS} clearLabel="No colour" onPick={(col) => { setLastMark(col); c().setHighlight({ color: col }).run(); setOpen(null); }} onClear={() => { c().unsetHighlight().run(); setOpen(null); }}/>
            </Drop>
            <Drop open={open} setOpen={setOpen} id="color" button={(toggle) => (
              <span style={{ display: 'inline-flex' }}>
                <Btn icon="ti-text-color" bar={lastColor} label="Font colour" onClick={() => c().setColor(lastColor).run()}/>
                <button type="button" aria-label="Font colours" onMouseDown={(e) => e.preventDefault()} onClick={toggle} style={CARET_BTN}><Icon name="ti-chevron-down" size={10}/></button>
              </span>
            )}>
              <Swatches colors={COLORS} clearLabel="Automatic" onPick={(col) => { setLastColor(col); c().setColor(col).run(); setOpen(null); }} onClear={() => { c().unsetColor().run(); setOpen(null); }}/>
            </Drop>
          </Row>
        </Col>
      </Group>
      <Group label="Paragraph">
        <Col>
          <Row>
            <Btn icon="ti-list" label="Bullets" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}/>
            <Btn icon="ti-list-numbers" label="Numbering" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}/>
            <Btn icon="ti-indent-decrease" label="Decrease indent (Shift+Tab)" onClick={() => c().outdent().run()}/>
            <Btn icon="ti-indent-increase" label="Increase indent (Tab)" onClick={() => c().indent().run()}/>
          </Row>
          <Row>
            {[['left', 'ti-align-left', 'Align left (Ctrl+L)'], ['center', 'ti-align-center', 'Centre (Ctrl+E)'], ['right', 'ti-align-right', 'Align right (Ctrl+R)'], ['justify', 'ti-align-justified', 'Justify (Ctrl+J)']].map(([a, ic, l]) => (
              <Btn key={a} icon={ic} label={l} active={editor.isActive({ textAlign: a }) || (a === 'left' && !['center', 'right', 'justify'].some((x) => editor.isActive({ textAlign: x })))} onClick={() => c().setTextAlign(a).run()}/>
            ))}
            <Drop open={open} setOpen={setOpen} id="spacing" button={(toggle, on) => <Btn icon="ti-line-height" label="Line and paragraph spacing" caret active={on} onClick={toggle}/>}>
              {LINE_SPACINGS.map((n) => <MenuItem key={n} label={n.toFixed(n % 1 ? 2 : 1).replace(/0$/, '')} checked={(curLine || 1.08) === n} onClick={() => { c().setLineHeight(n).run(); setOpen(null); }}/>)}
            </Drop>
          </Row>
        </Col>
      </Group>
      <Group label="Styles">
        <div style={{ display: 'flex', gap: 3 }}>
          {STYLES.map((s) => (
            <button key={s.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setStyle(s.key)} aria-pressed={curStyle === s.key}
              style={{ width: 66, height: 54, border: `1px solid ${curStyle === s.key ? WORD_BLUE : '#E1E1E1'}`, background: '#fff', borderRadius: 2, cursor: 'pointer', padding: '4px 3px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-start', overflow: 'hidden', flexShrink: 0 }}>
              <span style={{ fontFamily: s.key === 'title' ? "'Calibri Light', Calibri, sans-serif" : fontCss(DEFAULT_FONT), fontSize: s.key === 'title' ? 18 : s.key === 'h1' ? 14 : 12, color: s.key === 'h1' || s.key === 'h3' ? '#2F5496' : s.key === 'h2' ? '#1F3763' : '#000', fontStyle: s.key === 'quote' || s.key === 'h3' ? 'italic' : 'normal', whiteSpace: 'nowrap', lineHeight: 1.1 }}>AaBbCc</span>
              <span style={{ fontSize: 10, color: SUB, fontFamily: UI_FONT }}>{s.label}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group label="Editing" last>
        <Col>
          <Btn icon="ti-search" text="Find" wide label="Find (Ctrl+F)" onClick={() => setFind((f) => f || { q: '', r: '', n: 0 })}/>
          <Btn icon="ti-replace" text="Replace" wide label="Replace" onClick={() => setFind((f) => ({ q: f?.q || '', r: f?.r || '', replace: true }))}/>
        </Col>
        <Btn icon="ti-select-all" text="Select" big label="Select all (Ctrl+A)" onClick={() => c().selectAll().run()}/>
      </Group>
    </>
  );

  const tableGrid = (
    <div>
      <div style={{ fontSize: 12, color: SUB, padding: '2px 4px 6px' }}>{open?.startsWith?.('grid:') ? `${open.split(':')[1]} × ${open.split(':')[2]} table` : 'Insert table'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 18px)', gap: 3, padding: 4 }}>
        {Array.from({ length: 48 }, (_, k) => {
          const r = Math.floor(k / 8) + 1, col = (k % 8) + 1;
          const [, hr, hc] = String(open).split(':');
          const lit = open?.startsWith?.('grid:') && r <= Number(hr) && col <= Number(hc);
          return (
            <button key={k} type="button" aria-label={`${r} by ${col} table`}
              onMouseEnter={() => setOpen(`grid:${r}:${col}`)}
              onClick={() => { c().insertTable({ rows: r, cols: col, withHeaderRow: false }).run(); setOpen(null); }}
              style={{ width: 18, height: 18, padding: 0, border: `1px solid ${lit ? '#E8A33D' : '#BEBEBE'}`, background: lit ? '#FCE4B6' : '#fff', cursor: 'pointer' }}/>
          );
        })}
      </div>
    </div>
  );

  const insert = (
    <>
      <Group label="Tables">
        <Drop open={open?.startsWith?.('grid') ? 'grid' : open} setOpen={(v) => setOpen(v === 'grid' ? 'grid:0:0' : v)} id="grid" button={(toggle, on) => <Btn big icon="ti-table" text="Table" caret active={on} label="Insert a table" onClick={toggle}/>}>
          {tableGrid}
        </Drop>
      </Group>
      <Group label="Illustrations">
        <Btn big icon="ti-photo" text="Pictures" label="Insert a picture from your device" onClick={() => picRef.current?.click()}/>
        <input ref={picRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={(e) => { insertPicture(e.target.files?.[0]); e.target.value = ''; }}/>
      </Group>
      <Group label="Pages">
        <Btn big icon="ti-page-break" text="Page Break" label="Page break (Ctrl+Enter)" onClick={() => c().setPageBreak().run()}/>
        <Btn big icon="ti-separator-horizontal" text="Line" label="Horizontal line" onClick={() => c().setHorizontalRule().run()}/>
      </Group>
      <Group label="Links">
        <Drop open={open} setOpen={(v) => { setOpen(v); setLinkUrl(editor.getAttributes('link').href || ''); }} id="link" button={(toggle, on) => <Btn big icon="ti-link" text="Link" active={on || editor.isActive('link')} label="Insert a link" onClick={toggle}/>} width={260}>
          <div style={{ padding: 4 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 5 }}>Address</div>
            <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.nextSibling?.firstChild?.click(); } }}
              style={{ width: '100%', boxSizing: 'border-box', height: 28, border: '1px solid #C8C8C8', borderRadius: 2, padding: '0 7px', fontSize: 12.5 }}/>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="button" onClick={() => { const u = linkUrl.trim(); if (u) c().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(u) ? u : `https://${u}` }).run(); setOpen(null); }}
                style={{ flex: 1, height: 28, border: 'none', borderRadius: 2, background: WORD_BLUE, color: '#fff', fontSize: 12, cursor: 'pointer' }}>OK</button>
              <button type="button" onClick={() => { c().extendMarkRange('link').unsetLink().run(); setOpen(null); }}
                style={{ height: 28, padding: '0 10px', border: '1px solid #C8C8C8', borderRadius: 2, background: '#fff', fontSize: 12, cursor: 'pointer' }}>Remove link</button>
            </div>
          </div>
        </Drop>
      </Group>
      <Group label="Text">
        <Btn big icon="ti-calendar" text="Date" label="Insert today's date" onClick={() => c().insertContent(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })).run()}/>
      </Group>
      <Group label="Symbols" last>
        <Drop open={open} setOpen={setOpen} id="symbol" button={(toggle, on) => <Btn big icon="ti-omega" text="Symbol" caret active={on} label="Insert a symbol" onClick={toggle}/>} align="right">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 30px)', gap: 3 }}>
            {SYMBOLS.map((s) => (
              <button key={s} type="button" onClick={() => { c().insertContent(s).run(); setOpen(null); }}
                style={{ width: 30, height: 30, border: '1px solid #E1E1E1', background: '#fff', fontSize: 16, cursor: 'pointer', borderRadius: 2 }}>{s}</button>
            ))}
          </div>
        </Drop>
      </Group>
    </>
  );

  const layout = (
    <>
      <Group label="Page Setup">
        <Drop open={open} setOpen={setOpen} id="margins" button={(toggle, on) => <Btn big icon="ti-box-margin" text="Margins" caret active={on} label="Margins" onClick={toggle}/>} width={230}>
          {Object.entries(MARGINS).map(([k, m]) => <MenuItem key={k} label={m.label} note={m.note} checked={page.margins === k} onClick={() => changePage({ margins: k })}/>)}
        </Drop>
        <Drop open={open} setOpen={setOpen} id="orient" button={(toggle, on) => <Btn big icon="ti-file-orientation" text="Orientation" caret active={on} label="Orientation" onClick={toggle}/>}>
          <MenuItem label="Portrait" checked={page.orientation !== 'landscape'} onClick={() => changePage({ orientation: 'portrait' })}/>
          <MenuItem label="Landscape" checked={page.orientation === 'landscape'} onClick={() => changePage({ orientation: 'landscape' })}/>
        </Drop>
        <Drop open={open} setOpen={setOpen} id="size" button={(toggle, on) => <Btn big icon="ti-file" text="Size" caret active={on} label="Paper size" onClick={toggle}/>} width={200}>
          {Object.entries(PAGE_SIZES).map(([k, s]) => <MenuItem key={k} label={s.label} note={`${(s.w * 2.54).toFixed(1)} cm × ${(s.h * 2.54).toFixed(1)} cm`} checked={page.size === k} onClick={() => changePage({ size: k })}/>)}
        </Drop>
        <Btn big icon="ti-page-break" text="Breaks" label="Page break (Ctrl+Enter)" onClick={() => c().setPageBreak().run()}/>
      </Group>
      <Group label="Paragraph" last>
        <Col>
          <Btn icon="ti-indent-increase" text="Indent" wide label="Increase indent" onClick={() => c().indent().run()}/>
          <Btn icon="ti-indent-decrease" text="Outdent" wide label="Decrease indent" onClick={() => c().outdent().run()}/>
        </Col>
        <Drop open={open} setOpen={setOpen} id="spacing2" button={(toggle, on) => <Btn big icon="ti-line-height" text="Spacing" caret active={on} label="Line spacing" onClick={toggle}/>}>
          {LINE_SPACINGS.map((n) => <MenuItem key={n} label={String(n)} checked={(curLine || 1.08) === n} onClick={() => { c().setLineHeight(n).run(); setOpen(null); }}/>)}
        </Drop>
      </Group>
    </>
  );

  const viewTab = (
    <>
      <Group label="Views">
        <Btn big icon="ti-file-description" text="Print Layout" active={view === 'print'} label="Print layout — the real page" onClick={() => setView('print')}/>
        <Btn big icon="ti-device-mobile" text="Mobile View" active={view === 'mobile'} label="Mobile view — text fits the screen" onClick={() => setView('mobile')}/>
      </Group>
      <Group label="Show">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TXT, fontFamily: UI_FONT, padding: '0 6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={ruler} onChange={(e) => setRuler(e.target.checked)}/> Ruler
        </label>
      </Group>
      <Group label="Zoom" last>
        <Btn big icon="ti-zoom-in" text="Zoom In" label="Zoom in" disabled={view !== 'print'} onClick={() => setZoom((z) => Math.min(200, z + 10))}/>
        <Btn big icon="ti-zoom-out" text="Zoom Out" label="Zoom out" disabled={view !== 'print'} onClick={() => setZoom((z) => Math.max(50, z - 10))}/>
        <Btn big icon="ti-file" text="100%" label="Zoom to 100%" disabled={view !== 'print'} onClick={() => setZoom(100)}/>
        <Btn big icon="ti-arrows-horizontal" text="Page Width" label="Fit the page to the window" disabled={view !== 'print'}
          onClick={() => { const w = (canvasRef.current?.clientWidth || box.width) - 40; setZoom(Math.max(50, Math.min(200, Math.floor((w / box.width) * 100)))); }}/>
      </Group>
    </>
  );

  const tableTab = (
    <>
      <Group label="Rows & Columns">
        <Col>
          <Btn icon="ti-row-insert-top" text="Insert Above" wide label="Insert a row above" onClick={() => c().addRowBefore().run()}/>
          <Btn icon="ti-row-insert-bottom" text="Insert Below" wide label="Insert a row below" onClick={() => c().addRowAfter().run()}/>
        </Col>
        <Col>
          <Btn icon="ti-column-insert-left" text="Insert Left" wide label="Insert a column to the left" onClick={() => c().addColumnBefore().run()}/>
          <Btn icon="ti-column-insert-right" text="Insert Right" wide label="Insert a column to the right" onClick={() => c().addColumnAfter().run()}/>
        </Col>
      </Group>
      <Group label="Delete">
        <Col>
          <Btn icon="ti-row-remove" text="Delete Row" wide label="Delete row" onClick={() => c().deleteRow().run()}/>
          <Btn icon="ti-column-remove" text="Delete Column" wide label="Delete column" onClick={() => c().deleteColumn().run()}/>
        </Col>
        <Btn big icon="ti-table-off" text="Delete Table" label="Delete table" onClick={() => c().deleteTable().run()}/>
      </Group>
      <Group label="Merge">
        <Btn big icon="ti-arrows-join" text="Merge Cells" label="Merge the selected cells" disabled={!editor.can().mergeCells()} onClick={() => c().mergeCells().run()}/>
        <Btn big icon="ti-arrows-split" text="Split Cell" label="Split the cell" disabled={!editor.can().splitCell()} onClick={() => c().splitCell().run()}/>
      </Group>
      <Group label="Style" last>
        <Btn big icon="ti-table-row" text="Header Row" label="Header row" onClick={() => c().toggleHeaderRow().run()}/>
      </Group>
    </>
  );

  const pictureTab = (
    <>
      <Group label="Size">
        {[25, 50, 75, 100].map((p) => (
          <Btn key={p} big icon="ti-dimensions" text={`${p}%`} label={`Picture width ${p}% of the line`} active={Number(editor.getAttributes('image').widthPct) === p}
            onClick={() => c().updateAttributes('image', { widthPct: p }).run()}/>
        ))}
      </Group>
      <Group label="Arrange" last>
        <Btn big icon="ti-trash" text="Delete" label="Delete the picture" onClick={() => c().deleteSelection().run()}/>
      </Group>
    </>
  );

  const fileTab = (
    <>
      <Group label="Save">
        <Btn big icon="ti-device-floppy" text="Save to answer" label="Save to your answer (Ctrl+S)" onClick={save} disabled={saving}/>
        {onDownload && <Btn big icon="ti-download" text="Download" label="Download a copy (.docx)" onClick={() => onDownload(editor.getJSON(), page)}/>}
      </Group>
      <Group label="Info" last>
        <div style={{ fontSize: 12, color: TXT, fontFamily: UI_FONT, lineHeight: 1.6, padding: '0 6px' }}>
          <b>{fileName}</b><br/>
          <span style={{ color: SUB }}>{words} words · {pages} page{pages === 1 ? '' : 's'} · {PAGE_SIZES[page.size]?.label} {page.orientation}</span>
        </div>
      </Group>
    </>
  );

  const ribbon = { file: fileTab, home, insert, layout, view: viewTab, table: tableTab, picture: pictureTab }[tab] || home;

  return (
    <>
      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, background: RIBBON_BG, padding: '4px 8px 0', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }}>
        {tabs.map(([k, l]) => {
          const ctxTab = k === 'table' || k === 'picture';
          return (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setTab(k); setCollapsed(false); }}
              style={{ padding: '6px 12px 7px', border: 'none', borderBottom: `3px solid ${tab === k ? WORD_BLUE : 'transparent'}`, background: 'transparent', color: k === 'file' ? WORD_BLUE : ctxTab ? '#B45309' : tab === k ? WORD_BLUE : TXT, fontWeight: tab === k || k === 'file' ? 600 : 400, fontSize: 13, cursor: 'pointer', fontFamily: UI_FONT, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {l}
            </button>
          );
        })}
        <button type="button" aria-label={collapsed ? 'Show the ribbon' : 'Hide the ribbon'} onClick={() => setCollapsed((x) => !x)}
          style={{ marginLeft: 'auto', alignSelf: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: SUB, padding: '4px 6px', flexShrink: 0 }}>
          <Icon name={collapsed ? 'ti-chevron-down' : 'ti-chevron-up'} size={15}/>
        </button>
      </div>

      {/* Ribbon */}
      {!collapsed && (
        <div style={{ display: 'flex', alignItems: 'stretch', background: RIBBON_BG, borderBottom: `1px solid ${LINE}`, padding: '6px 4px 4px', overflowX: 'auto', overflowY: 'hidden', flexShrink: 0, minHeight: 86, boxSizing: 'border-box' }}>
          {ribbon}
        </div>
      )}

      {/* Find & replace */}
      {find && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 10px', background: '#fff', borderBottom: `1px solid ${LINE}`, fontSize: 12, flexShrink: 0 }}>
          <Icon name="ti-search" size={14} color={SUB}/>
          <input autoFocus value={find.q} placeholder="Find in document" onChange={(e) => setFind((f) => ({ ...f, q: e.target.value, done: null }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } }}
            style={{ width: 170, height: 26, border: '1px solid #C8C8C8', borderRadius: 2, padding: '0 7px', fontSize: 12.5 }}/>
          <span style={{ color: SUB, minWidth: 64 }}>{find.q ? `${matches.length} result${matches.length === 1 ? '' : 's'}` : ''}</span>
          <button type="button" onClick={findNext} disabled={!matches.length} style={{ height: 26, padding: '0 10px', border: '1px solid #C8C8C8', background: '#fff', borderRadius: 2, cursor: 'pointer', fontSize: 12 }}>Next</button>
          {find.replace && (
            <>
              <input value={find.r} placeholder="Replace with" onChange={(e) => setFind((f) => ({ ...f, r: e.target.value }))}
                style={{ width: 150, height: 26, border: '1px solid #C8C8C8', borderRadius: 2, padding: '0 7px', fontSize: 12.5 }}/>
              <button type="button" onClick={replaceAll} disabled={!matches.length} style={{ height: 26, padding: '0 10px', border: 'none', background: WORD_BLUE, color: '#fff', borderRadius: 2, cursor: 'pointer', fontSize: 12 }}>Replace All</button>
              {find.done != null && <span style={{ color: '#047857' }}>{find.done} replaced</span>}
            </>
          )}
          {!find.replace && <button type="button" onClick={() => setFind((f) => ({ ...f, replace: true }))} style={{ border: 'none', background: 'none', color: WORD_BLUE, cursor: 'pointer', fontSize: 12 }}>Replace…</button>}
          <button type="button" aria-label="Close find" onClick={() => setFind(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: SUB }}><Icon name="ti-x" size={14}/></button>
        </div>
      )}

      {err && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#FDE7E9', color: '#A4262C', fontSize: 12, borderBottom: '1px solid #F1BBBC', flexShrink: 0 }}>
          <Icon name="ti-alert-circle" size={14}/> <span style={{ flex: 1 }}>{err}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setErr('')} style={{ border: 'none', background: 'none', color: '#A4262C', cursor: 'pointer' }}><Icon name="ti-x" size={13}/></button>
        </div>
      )}
    </>
  );
}
