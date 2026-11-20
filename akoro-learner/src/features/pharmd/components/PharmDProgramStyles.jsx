/**
 * PharmDProgramStyles.jsx — the programme screen's stylesheet, verbatim
 * from PharmDProgram (untouched by the Phase 19 split).
 */
import { BRAND } from '../../../constants.js';
import { GREEN } from '../lib/pharmdUi.js';

export default function PharmDProgramStyles() {
  return (
      <style>{`
        .pd-page{position:fixed;inset:0;z-index:1500;background:var(--ak-bg,#FAFAFC);display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        /* Desktop/tablet — in-tab inside the app shell: plain flow content,
           the tab's own scroll container scrolls it, the shell chrome stays. */
        .pd-inline{width:100%;display:flex;justify-content:center;font-family:'Nunito',system-ui,sans-serif;color:var(--ak-text,#111827)}
        /* In-tab (tablet/desktop, >=768px) the 430px phone column and its
           centring are the MOBILE look — the page spans the full width of
           the shell's content area, like the Discover hub / Contents pages.
           Written as .pd-phone.pd-phone-inline so it beats .pd-phone's
           max-width/height/overflow/background regardless of rule order
           (a bare .pd-phone-inline loses to the later .pd-phone rule). */
        .pd-phone.pd-phone-inline{width:100%;max-width:none;height:auto;overflow:visible;background:transparent}
        .pd-phone{width:100%;max-width:430px;height:100%;overflow-y:auto;position:relative;background:var(--ak-bg,#FAFAFC);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
        .pd-back{width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,0.14);color:#fff;font-size:1.1rem;font-weight:700;cursor:pointer;margin-bottom:20px;font-family:inherit}
        /* Browse */
        .pd-hero{background:linear-gradient(160deg, ${BRAND} 0%, #2E1A6E 75%);padding:20px 22px 28px}
        .pd-hero h1{font-size:2.1rem;font-weight:900;margin:0;color:#fff}
        .pd-hero .pd-sub{color:rgba(255,255,255,0.75);font-weight:700;font-size:.85rem;margin-top:6px}
        .pd-section{padding:22px 0 4px}
        .pd-section h2{font-size:1.15rem;font-weight:800;margin:0 0 14px;padding:0 22px;color:var(--ak-text,#111827)}
        .pd-row{display:flex;gap:14px;overflow-x:auto;padding:0 22px 10px;scrollbar-width:none}
        .pd-row::-webkit-scrollbar{display:none}
        .pd-card{flex:0 0 132px;cursor:pointer;background:none;border:none;padding:0;text-align:left;font-family:inherit;color:inherit}
        .pd-card .pd-art{width:132px;height:132px;border-radius:14px;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;position:relative;overflow:hidden}
        .pd-card .pd-art::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.35) 100%)}
        .pd-card .pd-code{position:relative;z-index:1;font-weight:900;font-size:1.05rem;color:#fff}
        .pd-card .pd-name{font-size:.85rem;font-weight:700;margin-top:8px;color:var(--ak-text,#111827)}
        .pd-card .pd-meta{font-size:.74rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-card .pd-reads{font-size:.74rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:1px}
        .pd-empty{padding:18px 22px;flex:0 0 auto;width:100%}
        .pd-empty-card{border:1.5px dashed var(--ak-border2,#E5E7EB);border-radius:14px;padding:18px;text-align:center;color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem}
        /* Folder */
        .pd-folder-hero{padding:20px 22px 24px;position:relative}
        .pd-folder-art{width:100%;aspect-ratio:1.6;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:18px 0 20px;position:relative;overflow:hidden}
        /* In-tab the art spans the content area — keep it a banner: the
           reference's 1.6 ratio full-width would be a huge gradient slab. */
        .pd-phone.pd-phone-inline .pd-folder-art{max-height:280px}
        .pd-code-big{font-size:2.6rem;font-weight:900;color:rgba(255,255,255,0.92);letter-spacing:.02em}
        .pd-folder-title{font-size:1.5rem;font-weight:900;margin:0 0 4px;color:var(--ak-text,#111827)}
        .pd-author-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
        .pd-author-avatar{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:900;color:#fff}
        .pd-author-name{font-size:.86rem;font-weight:800;color:var(--ak-text,#111827)}
        .pd-folder-meta{color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem;margin:0 0 20px}
        .pd-action-row{display:flex;align-items:center;gap:14px;margin-bottom:8px}
        .pd-start{flex:1;padding:13px;border-radius:100px;border:none;background:${BRAND};color:#fff;font-family:inherit;font-weight:800;font-size:.95rem;cursor:pointer}
        .pd-icon-btn{width:44px;height:44px;border-radius:50%;border:1px solid var(--ak-border2,#E5E7EB);background:var(--ak-surface,#fff);color:var(--ak-text,#111827);font-size:1.1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-family:inherit;text-decoration:none}
        .pd-topic-list{padding:18px 10px 30px}
        .pd-topic-row{display:flex;align-items:center;gap:14px;padding:13px 12px;border-radius:12px;cursor:pointer}
        .pd-topic-row:hover{background:var(--ak-surface,#fff)}
        .pd-topic-num{width:30px;text-align:center;color:var(--ak-text-sub,#6B7280);font-weight:800;font-size:.9rem;flex-shrink:0}
        .pd-t-name{font-weight:700;font-size:.95rem;color:var(--ak-text,#111827)}
        .pd-t-meta{font-size:.76rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-check{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--ak-border2,#E5E7EB);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:${GREEN}}
        .pd-check.done{background:${GREEN};border-color:${GREEN};color:#fff}
        .pd-more{background:none;border:none;color:var(--ak-text-sub,#6B7280);padding:6px 4px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:inherit}
        .pd-upload{position:absolute;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.5);border:1.5px solid rgba(255,255,255,0.5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;font-family:inherit}
        .pd-card .pd-upload{width:24px;height:24px;top:6px;right:6px}
        .pd-folder-art .pd-upload{bottom:10px;right:10px}
        /* Action sheet */
        .pd-sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;z-index:40}
        .pd-sheet{width:100%;max-width:430px;background:var(--ak-surface,#fff);border-radius:20px 20px 0 0;padding:10px 0 max(18px, env(safe-area-inset-bottom));max-height:80vh;overflow-y:auto}
        @media (min-width:769px){.pd-sheet-overlay{align-items:center;padding:24px 16px}.pd-sheet{border-radius:20px}}
        .pd-sheet-handle{width:36px;height:4px;border-radius:100px;background:var(--ak-border2,#E5E7EB);margin:6px auto 14px}
        .pd-sheet-head{display:flex;align-items:center;gap:12px;padding:0 20px 16px;border-bottom:1px solid var(--ak-border,#F3F4F6)}
        .pd-sheet-art{width:48px;height:48px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.85rem;color:#fff}
        .pd-sheet-title{font-weight:800;font-size:.95rem;color:var(--ak-text,#111827)}
        .pd-sheet-sub{font-size:.78rem;color:var(--ak-text-sub,#6B7280);font-weight:600;margin-top:2px}
        .pd-sheet-actions{padding:8px 0}
        .pd-sheet-action{display:flex;align-items:center;gap:16px;padding:13px 20px;cursor:pointer;background:none;border:none;width:100%;text-align:left;font-family:inherit}
        .pd-sheet-action:hover{background:var(--ak-surface-hover,#F9FAFB)}
        .pd-s-icon{width:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .pd-s-label{font-size:.92rem;font-weight:700;color:var(--ak-text,#111827)}
        /* Loading / error states */
        .pd-state{padding:36px 22px;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--ak-text-sub,#6B7280);font-weight:700;font-size:.85rem}
      `}</style>
  );
}
