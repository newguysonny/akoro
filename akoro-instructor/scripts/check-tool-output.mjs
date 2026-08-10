#!/usr/bin/env node
/**
 * check-tool-output.mjs — every tool's output renders as itself.
 *
 * Six of the nine teaching tools return `doc`. Three do not: podcast returns a
 * two-speaker script, vocabulary returns term cards, essay-grader returns
 * scored criteria. The first version of the workbench rendered `doc` and dumped
 * the other three as raw JSON — a developer's view of a teacher's worksheet.
 *
 * The picker chooses on SHAPE rather than tool key, because a past run loaded
 * from /outputs/:id carries the document without the tool that made it. This
 * checks each shape reaches its own renderer, and that none of them falls back
 * to the JSON <pre>.
 *
 *   npm run check:tools
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Output } from '../src/components/ToolWorkbench.jsx';
const r = (doc) => renderToStaticMarkup(React.createElement(Output, { doc }));

const doc    = r({ title:'Plan', cards:[{ heading:'Overview', blocks:[{ label:'Objectives', bullets:['Do **X**'] }] }] });
const script = r({ title:'Ep 1', summary:'Short', turns:[{speaker:'Ade',text:'Welcome'},{speaker:'Ngozi',text:'Today: fractions'}] });
const vocab  = r({ title:'Words', cards:[{ term:'Numerator', definition:'Top number', example:'In 3/4 it is 3', tip:'Think “up”' }] });
const grades = r({ grades:[{ label:'Essay A', score:14, outOf:20, breakdown:[{criterion:'Structure',score:4,outOf:5,comment:'Clear'}], strengths:['Good opening'], improvements:['Cite sources'], feedback:'Solid work.' }] });

console.log('doc    → cards + bold      :', doc.includes('Overview') && doc.includes('<strong'));
console.log('script → speakers rendered :', script.includes('Ade') && script.includes('Ngozi') && !script.includes('JSON'));
console.log('vocab  → term cards        :', vocab.includes('Numerator') && vocab.includes('Top number'));
console.log('grades → score + criterion :', grades.includes('14') && grades.includes('Structure') && grades.includes('Cite sources'));
console.log('none of them fell to JSON  :', ![doc,script,vocab,grades].some(h => h.includes('<pre')));

const ok = [doc, script, vocab, grades].every((h) => h.length > 0 && !h.includes('<pre'));
console.log(ok ? '\n\u2713 every tool output renders as itself\n' : '\n\u2717 an output fell back to JSON\n');
process.exit(ok ? 0 : 1);
