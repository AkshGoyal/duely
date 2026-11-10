import { isValidDate, toPaise, toRupees } from '../lib/format';
import { InvoiceInput, LineItem, STATUSES, Status } from '../services/invoices';
import { html } from './html';
import { icon } from './icons';
import { inputCls, labelCls } from './ui';

export interface FormValues {
  invoice_number?: string;
  client_name?: string;
  client_phone?: string | null;
  client_email?: string | null;
  amount_paise?: number;
  issue_date?: string;
  due_date?: string;
  notes?: string | null;
  status?: Status;
  promise_date?: string | null;
  line_items?: LineItem[];
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]);

/** Validates a submitted invoice form. Returns a patch for the invoices service or a readable error. */
export function parseInvoiceForm(body: Record<string, unknown>, mode: 'new' | 'edit'): { data?: InvoiceInput; error?: string } {
  const s = (k: string) => String(body[k] ?? '').trim();
  const client_name = s('client_name');
  if (!client_name) return { error: 'Client name is required.' };
  const amount = Number(s('amount').replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be a number greater than 0.' };
  if (amount > 1e10) return { error: 'Amount is too large (max ₹1,000 crore).' };
  const due_date = s('due_date');
  if (!isValidDate(due_date)) return { error: 'Due date is required.' };
  const issue_date = s('issue_date');
  if (issue_date && !isValidDate(issue_date)) return { error: 'Issue date is not a valid date.' };
  const promise_date = s('promise_date');
  if (promise_date && !isValidDate(promise_date)) return { error: 'Promise date is not a valid date.' };
  const client_email = s('client_email');
  if (client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) return { error: 'Client email looks invalid.' };
  const status = s('status') as Status;
  if (status && !STATUSES.includes(status)) return { error: 'Unknown status.' };

  const descs = arr(body.li_desc);
  const amts = arr(body.li_amount);
  const line_items: LineItem[] = [];
  for (let i = 0; i < Math.max(descs.length, amts.length); i++) {
    const d = (descs[i] ?? '').trim();
    const a = (amts[i] ?? '').trim();
    if (!d && !a) continue;
    const n = Number(a.replace(/,/g, ''));
    if (!d || !Number.isFinite(n) || n <= 0 || n > 1e10) return { error: `Line item ${i + 1} needs a description and an amount greater than 0.` };
    line_items.push({ description: d.slice(0, 300), amount_paise: toPaise(n) });
  }

  const data: InvoiceInput = {
    client_name,
    amount_paise: toPaise(amount),
    due_date,
    client_phone: s('client_phone') || null,
    client_email: client_email || null,
    notes: s('notes') || null,
    line_items,
  };
  if (s('invoice_number')) data.invoice_number = s('invoice_number');
  if (issue_date) data.issue_date = issue_date;
  if (status) data.status = status;
  if (mode === 'edit') data.promise_date = promise_date || null;
  return { data };
}

const lineRow = (li?: { description: string; amount: number | string }) => html`
  <div class="li-row flex gap-2">
    <input class="${inputCls}" name="li_desc" placeholder="Description" value="${li?.description ?? ''}" maxlength="300" />
    <input class="${inputCls} w-36 text-right num" name="li_amount" type="number" step="0.01" min="0" placeholder="₹" value="${li?.amount ?? ''}" />
    <button type="button" class="li-remove inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors" aria-label="Remove line">${icon('x')}</button>
  </div>`;

export function invoiceFormFields(v: FormValues, mode: 'new' | 'edit') {
  const field = (name: string, label: string, input: unknown, span = '') =>
    html`<div class="${span}"><label class="${labelCls}" for="${name}">${label}</label>${input}</div>`;
  const statuses = mode === 'new' ? (['sent', 'draft'] as Status[]) : [...STATUSES];

  return html`
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
    ${field('client_name', 'Client name *', html`<input class="${inputCls}" id="client_name" name="client_name" required maxlength="200" value="${v.client_name ?? ''}" />`, 'sm:col-span-2')}
    ${field('client_phone', 'Client WhatsApp', html`<input class="${inputCls}" id="client_phone" name="client_phone" type="tel" placeholder="+91 98765 43210" value="${v.client_phone ?? ''}" />`)}
    ${field('client_email', 'Client email', html`<input class="${inputCls}" id="client_email" name="client_email" type="email" value="${v.client_email ?? ''}" />`)}
    ${field('amount', 'Amount (₹) *', html`<input class="${inputCls} num" id="amount" name="amount" type="number" step="0.01" min="0.01" required value="${v.amount_paise ? toRupees(v.amount_paise) : ''}" />`)}
    ${field('invoice_number', 'Invoice number', html`<input class="${inputCls}" id="invoice_number" name="invoice_number" maxlength="50" placeholder="${mode === 'new' ? 'Auto (INV-001…)' : ''}" value="${v.invoice_number ?? ''}" ${mode === 'edit' ? 'required' : ''} />`)}
    ${field('issue_date', 'Issue date', html`<input class="${inputCls}" id="issue_date" name="issue_date" type="date" value="${v.issue_date ?? ''}" />`)}
    ${field('due_date', 'Due date *', html`<input class="${inputCls}" id="due_date" name="due_date" type="date" required value="${v.due_date ?? ''}" />`)}
    ${field('status', mode === 'edit' ? 'Status (override)' : 'Status', html`<select class="${inputCls}" id="status" name="status">
        ${statuses.map((s) => html`<option value="${s}" ${v.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`)}
      </select>`)}
    ${mode === 'edit'
      ? field('promise_date', 'Client promised to pay by', html`<input class="${inputCls}" id="promise_date" name="promise_date" type="date" value="${v.promise_date ?? ''}" />`)
      : ''}
    ${field('notes', 'Notes (shown on the pay page)', html`<textarea class="${inputCls}" id="notes" name="notes" rows="2" maxlength="2000">${v.notes ?? ''}</textarea>`, 'sm:col-span-2')}
  </div>

  <div class="mt-6">
    <div class="flex items-center justify-between mb-2">
      <span class="text-sm font-medium text-slate-700">Line items <span class="font-normal text-slate-400">(optional)</span></span>
      <span class="text-xs text-slate-500">Total: <span id="li-total" class="num font-medium text-slate-700">₹0</span>
        <button type="button" id="li-use-total" class="ml-2 text-brand-700 hover:underline">Use as amount</button></span>
    </div>
    <div id="li-list" class="space-y-2">
      ${(v.line_items?.length ? v.line_items : [undefined]).map((li) =>
        lineRow(li ? { description: li.description, amount: toRupees(li.amount_paise) } : undefined),
      )}
    </div>
    <template id="li-template">${lineRow()}</template>
    <button type="button" id="li-add" class="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors">${icon('plus')} Add line</button>
  </div>

  <script>
    (function () {
      const list = document.getElementById('li-list');
      const tpl = document.getElementById('li-template');
      const total = document.getElementById('li-total');
      const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
      const sum = () => [...list.querySelectorAll('input[name=li_amount]')].reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
      const update = () => (total.textContent = fmt.format(sum()));
      document.getElementById('li-add').onclick = () => { list.appendChild(tpl.content.cloneNode(true)); update(); };
      document.getElementById('li-use-total').onclick = () => { const t = sum(); if (t > 0) document.getElementById('amount').value = t.toFixed(2).replace(/\\.00$/, ''); };
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('.li-remove'); if (!btn) return;
        const row = btn.closest('.li-row');
        if (list.querySelectorAll('.li-row').length > 1) row.remove(); else row.querySelectorAll('input').forEach((i) => (i.value = ''));
        update();
      });
      list.addEventListener('input', update);
      update();
    })();
  </script>`;
}
