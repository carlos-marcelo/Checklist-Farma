
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    AuditData,
    ViewState,
    AuditStatus,
    Group,
    Department,
    Category,
    Product
} from './types';
import {
    fetchLatestAudit,
    upsertAuditSession,
    insertAppEventLog,
    fetchLatestAuditMetadata,
    type DbGlobalBaseFile,
    type DbAuditSession
} from '../../supabaseService';
import { CadastrosBaseService } from '../../src/cadastrosBase/cadastrosBaseService';
import { CacheService } from '../../src/cacheService';
import * as AuditStorage from '../../src/auditoria/storage';
import ProgressBar from './ProgressBar';
import Breadcrumbs from './Breadcrumbs';
import SignaturePad from '../SignaturePad';
import { ImageUtils } from '../../src/utils/imageUtils';
import {
    ClipboardList,
    FileBox,
    FileSpreadsheet,
    Power,
    ChevronRight,
    CheckCircle2,
    CheckSquare,
    FileSignature,
    ArrowLeft,
    Boxes,
    Activity,
    Search,
    RefreshCw,
    X,
    Upload
} from 'lucide-react';

const GROUP_UPLOAD_IDS = ['2000', '3000', '4000', '8000', '10000', '66', '67'] as const;
type GroupUploadId = typeof GROUP_UPLOAD_IDS[number];
const GROUP_GLOBAL_BASE_KEYS: Record<GroupUploadId, string> = {
    '2000': 'audit_cadastro_2000',
    '3000': 'audit_cadastro_3000',
    '4000': 'audit_cadastro_4000',
    '8000': 'audit_cadastro_8000',
    '10000': 'audit_cadastro_10000',
    '66': 'audit_cadastro_66',
    '67': 'audit_cadastro_67'
};
const AUDIT_DEPT_IDS_GLOBAL_KEY = 'audit_ids_departamento';
const AUDIT_CAT_IDS_GLOBAL_KEY = 'audit_ids_categoria';
const ALLOWED_IDS = GROUP_UPLOAD_IDS.map(id => Number(id));
const FILIAIS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18];

const GROUP_CONFIG_DEFAULTS: Record<string, string> = {
    "2000": "Medicamentos Similar",
    "3000": "Medicamentos RX",
    "4000": "Medicamentos Genérico",
    "66": "Genérico + Similar sem margem",
    "67": "Genérico + Similar sem margem",
    "8000": "Higiene e Beleza",
    "10000": "Conveniência"
};

const createInitialGroupFiles = (): Record<GroupUploadId, File | null> => ({
    "2000": null,
    "3000": null,
    "4000": null,
    "8000": null,
    "10000": null,
    "66": null,
    "67": null
});

const createInitialGroupMeta = (): Record<GroupUploadId, DbGlobalBaseFile | null> => ({
    "2000": null,
    "3000": null,
    "4000": null,
    "8000": null,
    "10000": null,
    "66": null,
    "67": null
});

const decodeGlobalFileToBrowserFile = (file: DbGlobalBaseFile): File | null => {
    if ((file as any)._parsedFile) return (file as any)._parsedFile;

    const raw = String(file?.file_data_base64 || '').trim();
    if (!raw) return null;

    let mimeType = file?.mime_type || 'application/octet-stream';
    let base64 = raw;
    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.*)$/);
    if (dataUrlMatch) {
        mimeType = dataUrlMatch[1] || mimeType;
        base64 = dataUrlMatch[2] || '';
    }
    if (!base64) return null;

    try {
        const binary = window.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const originalName = file.file_name || `${file.module_key || 'base'}.xlsx`;
        const fileName = originalName.startsWith('[GLOBAL] ') ? originalName : `[GLOBAL] ${originalName}`;
        return new File([bytes], fileName, { type: mimeType });
    } catch (error) {
        console.error('Erro ao decodificar arquivo global da auditoria:', error);
        return null;
    }
};

const TRIER_API_BASE =
    ((import.meta as any).env?.VITE_TRIER_INTEGRATION_URL as string) || "http://localhost:8000";

const normalizeAuditStatus = (status: unknown): AuditStatus => {
    if (status === AuditStatus.DONE || status === 'DONE' || status === 'concluido') return AuditStatus.DONE;
    if (status === AuditStatus.IN_PROGRESS || status === 'IN_PROGRESS' || status === 'iniciado') return AuditStatus.IN_PROGRESS;
    return AuditStatus.TODO;
};

const parseNumericToken = (token: string): number | null => {
    if (!token) return null;

    const hasDot = token.includes('.');
    const hasComma = token.includes(',');
    let normalized = token;

    if (hasDot && hasComma) {
        if (token.lastIndexOf(',') > token.lastIndexOf('.')) {
            normalized = token.replace(/\./g, '').replace(',', '.');
        } else {
            normalized = token.replace(/,/g, '');
        }
    } else if (hasComma) {
        normalized = /,\d{1,2}$/.test(token) ? token.replace(',', '.') : token.replace(/,/g, '');
    } else if (hasDot) {
        const dotCount = (token.match(/\./g) || []).length;
        normalized = (dotCount === 1 && /\.\d{1,2}$/.test(token)) ? token : token.replace(/\./g, '');
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed);
};

const extractSheetNumericCodes = (value: unknown): number[] => {
    if (value === null || value === undefined) return [];
    if (typeof value === 'number' && Number.isFinite(value)) return [Math.round(value)];

    const raw = String(value).trim();
    if (!raw) return [];

    const tokens = raw.match(/\d[\d.,]*/g) || [];
    const parsed = tokens
        .map(parseNumericToken)
        .filter((v): v is number => v !== null);

    return Array.from(new Set(parsed));
};

const parseSheetNumericCode = (value: unknown): number | null => {
    const values = extractSheetNumericCodes(value);
    return values.length ? values[0] : null;
};

const normalizeLookupText = (value: unknown) =>
    String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

const parseHierarchyCell = (value: unknown, fallbackName: string) => {
    const raw = (value ?? '').toString().trim();
    if (!raw) return { numericId: '', name: fallbackName };

    const numericId = parseSheetNumericCode(raw);
    const name = raw
        .replace(/^\s*\d[\d.,]*\s*[-:/.]*\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        numericId: numericId !== null ? String(numericId) : '',
        name: name || raw || fallbackName
    };
};

const findBarcodeInRow = (row: any[]): string => {
    const normalize = (val: any) => {
        if (val === null || val === undefined) return '';
        let s = val.toString().trim();
        if (s.includes('E+') || s.includes('e+')) {
            s = Number(val).toLocaleString('fullwide', { useGrouping: false });
        }
        return s.replace(/\D/g, '').replace(/^0+/, '');
    };

    const fromMainCol = normalize(row?.[11]);
    if (fromMainCol) return fromMainCol;

    for (const cell of row || []) {
        const candidate = normalize(cell);
        if (candidate.length >= 8 && candidate.length <= 14) return candidate;
    }
    return '';
};

const isDoneStatus = (status?: AuditStatus | string) => normalizeAuditStatus(status) === AuditStatus.DONE;
const isInProgressStatus = (status?: AuditStatus | string) => normalizeAuditStatus(status) === AuditStatus.IN_PROGRESS;
const normalizeScopeId = (val?: string | number | null) => (val === undefined || val === null ? '' : String(val));
const createBatchId = () => {
    const cryptoObj = (window as any)?.crypto;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
    return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const getEntryBatchId = (entry: { batchId?: string; groupId?: string | number; deptId?: string | number; catId?: string | number }) =>
    entry.batchId || partialScopeKey(entry);

const partialCompletedKey = (entry: { batchId?: string; groupId?: string | number; deptId?: string | number; catId?: string | number }) =>
    `${getEntryBatchId(entry)}|${partialScopeKey(entry)}`;

const getLatestBatchId = (entries?: Array<{ completedAt?: string; startedAt?: string; batchId?: string; groupId?: string | number; deptId?: string | number; catId?: string | number }>) => {
    if (!entries || entries.length === 0) return undefined;
    let latest = entries[0];
    let latestTs = new Date(latest.completedAt || latest.startedAt || 0).getTime();
    entries.forEach(e => {
        const ts = new Date(e.completedAt || e.startedAt || 0).getTime();
        if (ts > latestTs) {
            latest = e;
            latestTs = ts;
        }
    });
    return getEntryBatchId(latest);
};

const partialScopeKey = (scope: { groupId?: string | number; deptId?: string | number; catId?: string | number } | undefined) => {
    if (!scope) return '';
    return [normalizeScopeId(scope.groupId), normalizeScopeId(scope.deptId), normalizeScopeId(scope.catId)].join('|');
};

const isPartialScopeMatch = (
    partial: { groupId?: string | number; deptId?: string | number; catId?: string | number } | undefined,
    groupId?: string | number,
    deptId?: string | number,
    catId?: string | number
) => {
    if (!partial) return false;
    const pGroup = normalizeScopeId(partial.groupId);
    const pDept = normalizeScopeId(partial.deptId);
    const pCat = normalizeScopeId(partial.catId);
    const g = normalizeScopeId(groupId);
    const d = normalizeScopeId(deptId);
    const c = normalizeScopeId(catId);
    if (g && pGroup && pGroup !== g) return false;
    if (d && pDept && pDept !== d) return false;
    if (c && pCat && pCat !== c) return false;
    return true;
};

const scopeContainsPartial = (
    partial: { groupId?: string | number; deptId?: string | number; catId?: string | number },
    groupId?: string | number,
    deptId?: string | number,
    catId?: string | number
) => {
    const pGroup = normalizeScopeId(partial.groupId);
    const pDept = normalizeScopeId(partial.deptId);
    const pCat = normalizeScopeId(partial.catId);
    const g = normalizeScopeId(groupId);
    const d = normalizeScopeId(deptId);
    const c = normalizeScopeId(catId);
    if (!g || pGroup !== g) return false;
    if (!d) return true;
    if (pDept !== d) return false;
    if (!c) return true;
    return pCat === c;
};

type TermScopeType = 'group' | 'department' | 'category' | 'custom';

interface TermScope {
    type: TermScopeType;
    groupId?: string;
    deptId?: string;
    catId?: string;
    customScopes?: Array<{ groupId?: string; deptId?: string; catId?: string }>;
    customLabel?: string;
    batchId?: string;
}

interface TermCollaborator {
    name: string;
    cpf: string;
    signature: string;
}

interface TermForm {
    inventoryNumber: string;
    date: string;
    managerName2: string;
    managerCpf2: string;
    managerSignature2: string;
    managerName: string;
    managerCpf: string;
    managerSignature: string;
    collaborators: TermCollaborator[];
    excelMetrics?: {
        sysQty: number;
        sysCost: number;
        countedQty: number;
        countedCost: number;
        diffQty: number;
        diffCost: number;
        items: any[];
        groupedDifferences?: any[];
    };
    excelMetricsRemovedAt?: string;
}

const getScopeGroupIds = (scope?: TermScope | null): string[] => {
    if (!scope) return [];
    const ids = new Set<string>();
    const addId = (value?: string | number) => {
        const normalized = normalizeScopeId(value);
        if (normalized) ids.add(normalized);
    };
    addId(scope.groupId);
    (scope.customScopes || []).forEach(s => addId(s.groupId));
    return Array.from(ids);
};

const mergeTermDraftMaps = (
    current: Record<string, TermForm> | undefined,
    incoming: Record<string, TermForm> | undefined
): Record<string, TermForm> => {
    const base = { ...(current || {}) };
    Object.entries(incoming || {}).forEach(([key, incomingDraft]) => {
        const currentDraft = base[key];
        if (!currentDraft) {
            base[key] = incomingDraft;
            return;
        }
        const nextMetrics = incomingDraft?.excelMetrics ?? currentDraft?.excelMetrics;
        let nextRemovedAt = incomingDraft?.excelMetricsRemovedAt ?? currentDraft?.excelMetricsRemovedAt;
        if (incomingDraft?.excelMetrics) nextRemovedAt = undefined;
        base[key] = nextMetrics
            ? { ...currentDraft, ...incomingDraft, excelMetrics: nextMetrics, excelMetricsRemovedAt: nextRemovedAt }
            : { ...currentDraft, ...incomingDraft, excelMetricsRemovedAt: nextRemovedAt };
    });
    return base;
};

const mergeExcelMetricsPools = (pools: any[]): any | null => {
    const validPools = (pools || []).filter(Boolean);
    if (validPools.length === 0) return null;
    if (validPools.length === 1) return validPools[0];

    const normText = (value: unknown) =>
        String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    const normCode = (value: unknown) => String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');

    const uniqueItems = new Map<string, any>();
    validPools.forEach((pool) => {
        (Array.isArray(pool.items) ? pool.items : []).forEach((it: any) => {
            const keyObj = {
                code: normCode(it?.code),
                groupName: normText(it?.groupName),
                deptName: normText(it?.deptName),
                catName: normText(it?.catName),
                sysQty: Number(it?.sysQty || 0),
                countedQty: Number(it?.countedQty || 0),
                diffQty: Number(it?.diffQty || 0),
                sysCost: Number(it?.sysCost || 0),
                countedCost: Number(it?.countedCost || 0),
                diffCost: Number(it?.diffCost || 0)
            };
            const key = JSON.stringify(keyObj);
            if (!uniqueItems.has(key)) uniqueItems.set(key, it);
        });
    });

    if (uniqueItems.size > 0) {
        const items = Array.from(uniqueItems.values());
        const totals = items.reduce((acc: any, it: any) => ({
            sysQty: (acc.sysQty || 0) + Number(it?.sysQty || 0),
            sysCost: (acc.sysCost || 0) + Number(it?.sysCost || 0),
            countedQty: (acc.countedQty || 0) + Number(it?.countedQty || 0),
            countedCost: (acc.countedCost || 0) + Number(it?.countedCost || 0),
            diffQty: (acc.diffQty || 0) + Number(it?.diffQty || 0),
            diffCost: (acc.diffCost || 0) + Number(it?.diffCost || 0)
        }), { sysQty: 0, sysCost: 0, countedQty: 0, countedCost: 0, diffQty: 0, diffCost: 0 });

        const groupedMap: Record<string, any> = {};
        items.forEach((it: any) => {
            const g = it?.groupName || '';
            const d = it?.deptName || '';
            const c = it?.catName || '';
            const gKey = `${g}|${d}|${c}`;
            if (!groupedMap[gKey]) {
                groupedMap[gKey] = {
                    groupName: g,
                    deptName: d,
                    catName: c,
                    sysQty: 0,
                    sysCost: 0,
                    countedQty: 0,
                    countedCost: 0,
                    diffQty: 0,
                    diffCost: 0
                };
            }
            groupedMap[gKey].sysQty += Number(it?.sysQty || 0);
            groupedMap[gKey].sysCost += Number(it?.sysCost || 0);
            groupedMap[gKey].countedQty += Number(it?.countedQty || 0);
            groupedMap[gKey].countedCost += Number(it?.countedCost || 0);
            groupedMap[gKey].diffQty += Number(it?.diffQty || 0);
            groupedMap[gKey].diffCost += Number(it?.diffCost || 0);
        });

        return {
            ...totals,
            items,
            groupedDifferences: Object.values(groupedMap)
        };
    }

    const fallback = validPools.reduce((acc: any, curr: any) => ({
        sysQty: (acc.sysQty || 0) + (curr.sysQty || 0),
        sysCost: (acc.sysCost || 0) + (curr.sysCost || 0),
        countedQty: (acc.countedQty || 0) + (curr.countedQty || 0),
        countedCost: (acc.countedCost || 0) + (curr.countedCost || 0),
        diffQty: (acc.diffQty || 0) + (curr.diffQty || 0),
        diffCost: (acc.diffCost || 0) + (curr.diffCost || 0),
        items: [...(acc.items || []), ...(curr.items || [])],
        groupedDifferences: [...(acc.groupedDifferences || []), ...(curr.groupedDifferences || [])]
    }), { sysQty: 0, sysCost: 0, countedQty: 0, countedCost: 0, diffQty: 0, diffCost: 0, items: [], groupedDifferences: [] });

    return fallback;
};

const parseCustomDraftKeyMeta = (draftKey: string): null | { batchId?: string; scopesPart: string } => {
    const match = draftKey.match(/^custom\|([^|]*)(?:\|(.*))?$/);
    if (!match) return null;
    const hasNewFormat = typeof match[2] === 'string';
    if (hasNewFormat) return { batchId: (match[1] || '').trim() || undefined, scopesPart: match[2] || '' };
    return { batchId: undefined, scopesPart: match[1] || '' };
};

const draftKeyTouchesGroup = (draftKey: string, groupId?: string | number): boolean => {
    const target = normalizeScopeId(groupId);
    if (!target) return false;
    if (draftKey.startsWith('custom|')) {
        // Compatibilidade: formato novo "custom|<batchId>|<scopes>" e legado "custom|<scopes>"
        const meta = parseCustomDraftKeyMeta(draftKey);
        const scopesPart = meta?.scopesPart || '';
        const scopedKeys = scopesPart.split(',').filter(Boolean);
        return scopedKeys.some(scopeKey => normalizeScopeId(scopeKey.split('|')[0]) === target);
    }
    const parts = draftKey.split('|');
    return normalizeScopeId(parts[1]) === target;
};

const getExcelPoolsByGroupFromDrafts = (
    drafts: Record<string, TermForm> | undefined,
    groupId?: string | number,
    options?: { batchId?: string }
) => {
    const targetBatch = normalizeScopeId(options?.batchId);
    return Object.entries(drafts || {})
        .filter(([key, draft]) => {
            if (!draft?.excelMetrics || draft?.excelMetricsRemovedAt) return false;
            if (!draftKeyTouchesGroup(key, groupId)) return false;
            if (!targetBatch) return true;
            if (!key.startsWith('custom|')) return false;
            const meta = parseCustomDraftKeyMeta(key);
            const draftBatch = normalizeScopeId(meta?.batchId);
            return draftBatch === targetBatch;
        })
        .map(([, draft]) => draft!.excelMetrics)
        .filter(Boolean);
};

const getFinancialRepresentativity = (auditedBaseCost?: number, diffCost?: number): number | null => {
    const base = Math.abs(Number(auditedBaseCost || 0));
    if (!base || !Number.isFinite(base)) return null;
    const diff = Math.abs(Number(diffCost || 0));
    if (!Number.isFinite(diff)) return null;
    return (diff / base) * 100;
};

const getAuditDataStrength = (auditData: AuditData | null | undefined): number => {
    if (!auditData) return 0;
    const groupsCount = Array.isArray(auditData.groups) ? auditData.groups.length : 0;
    let categoriesCount = 0;
    let productsCount = 0;
    let doneCategories = 0;
    (auditData.groups || []).forEach((g) => {
        g.departments.forEach((d) => {
            categoriesCount += d.categories.length;
            d.categories.forEach((c) => {
                productsCount += c.products.length;
                if (isDoneStatus(c.status)) doneCategories += 1;
            });
        });
    });
    const termDraftsCount = Object.keys(((auditData as any)?.termDrafts || {})).length;
    const partialStartsCount = Array.isArray((auditData as any)?.partialStarts) ? (auditData as any).partialStarts.length : 0;
    const partialCompletedCount = Array.isArray((auditData as any)?.partialCompleted) ? (auditData as any).partialCompleted.length : 0;
    return (
        groupsCount * 1000 +
        categoriesCount * 100 +
        doneCategories * 80 +
        productsCount +
        termDraftsCount * 30 +
        partialStartsCount * 20 +
        partialCompletedCount * 20
    );
};

const reconcileAuditStateFromCompletedScopes = (input: AuditData): AuditData => {
    const completed = Array.isArray((input as any)?.partialCompleted) ? (input as any).partialCompleted : [];
    if (!Array.isArray(input?.groups) || completed.length === 0) return input;

    const nextGroups = input.groups.map((g) => ({
        ...g,
        departments: g.departments.map((d) => ({
            ...d,
            categories: d.categories.map((c) => {
                const current = normalizeAuditStatus(c.status);
                if (current === AuditStatus.DONE) return { ...c, status: current };
                const doneByCompleted = completed.some((p: any) => isPartialScopeMatch(p, g.id, d.id, c.id));
                return { ...c, status: doneByCompleted ? AuditStatus.DONE : current };
            })
        }))
    }));

    return {
        ...input,
        groups: nextGroups
    };
};

const ExcelMetricsDashboard: React.FC<{
    metrics: {
        sysQty: number;
        sysCost: number;
        countedQty: number;
        countedCost: number;
        diffQty: number;
        diffCost: number;
    };
    auditedBaseCost?: number;
}> = ({ metrics, auditedBaseCost }) => {
    if (!metrics || typeof metrics.diffQty !== 'number') return null;
    const representativity = getFinancialRepresentativity(auditedBaseCost ?? metrics.countedCost, metrics.diffCost);

    return (
        <div className="mt-4 pt-4 border-t border-indigo-100/50">
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest mb-3">
                <span className="text-indigo-800 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Planilha de Divergências</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Est. Sist (Qtde)</span>
                    <span className="text-[14px] font-black text-slate-700">{Math.round(metrics.sysQty).toLocaleString('pt-BR')} un.</span>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Est. Físico (Qtde)</span>
                    <span className="text-[14px] font-black text-slate-700">{Math.round(metrics.countedQty).toLocaleString('pt-BR')} un.</span>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Diferença (Qtde)</span>
                    <span className={`text-[14px] font-black ${metrics.diffQty < 0 ? 'text-red-600' : metrics.diffQty > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                        {metrics.diffQty > 0 ? '+' : ''}{Math.round(metrics.diffQty).toLocaleString('pt-BR')} un.
                    </span>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Custo Sist</span>
                    <span className="text-[14px] font-black text-slate-700">{metrics.sysCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Custo Físico</span>
                    <span className="text-[14px] font-black text-slate-700">{metrics.countedCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                </div>
                <div className={`border rounded-lg p-2 ${metrics.diffCost < 0 ? 'bg-red-50 border-red-200' : metrics.diffCost > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100'}`}>
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Resultado Fin.</span>
                    <span className={`text-[14px] font-black ${metrics.diffCost < 0 ? 'text-red-700' : metrics.diffCost > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {metrics.diffCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                    {metrics.diffCost < 0 && <span className="text-[8px] font-black text-red-500 uppercase block">Prejuízo</span>}
                    {metrics.diffCost > 0 && <span className="text-[8px] font-black text-emerald-600 uppercase block">Sobra</span>}
                    {representativity !== null && (
                        <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest block mt-1">
                            Rep. Auditada: {representativity.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

interface AuditModuleProps {
    userEmail: string;
    userName: string;
    userRole: string;
    companies: any[];
}

const AuditModule: React.FC<AuditModuleProps> = ({ userEmail, userName, userRole, companies }) => {
    const isMaster = userRole === 'MASTER';
    const [data, setData] = useState<AuditData | null>(null);
    const [view, setView] = useState<ViewState>({ level: 'groups' });
    const [isProcessing, setIsProcessing] = useState(false);
    const [isTrierLoading, setIsTrierLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [trierError, setTrierError] = useState<string | null>(null);
    const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
    const [initialDoneUnits, setInitialDoneUnits] = useState<number>(0);
    const [termModal, setTermModal] = useState<TermScope | null>(null);
    const [termForm, setTermForm] = useState<TermForm | null>(null);
    const [termDrafts, setTermDrafts] = useState<Record<string, TermForm>>({});
    const [termComparisonMetrics, setTermComparisonMetrics] = useState<{
        sysQty: number;
        sysCost: number;
        countedQty: number;
        countedCost: number;
        diffQty: number;
        diffCost: number;
        items: any[];
        groupedDifferences?: any[];
    } | null>(null);
    const [expandedCatKeys, setExpandedCatKeys] = useState<Set<string>>(new Set());
    const [auditLookup, setAuditLookup] = useState('');
    const [auditLookupOpen, setAuditLookupOpen] = useState(false);
    const auditLookupInputRef = useRef<HTMLInputElement | null>(null);
    const removedExcelDraftKeysRef = useRef<Set<string>>(new Set());

    const [selectedEmpresa, setSelectedEmpresa] = useState("Drogaria Cidade");
    const [selectedFilial, setSelectedFilial] = useState("");
    const selectedCompany = useMemo(() => companies.find(c => c.name === selectedEmpresa), [companies, selectedEmpresa]);
    const [nextAuditNumber, setNextAuditNumber] = useState(1);
    // Persiste o ID da sessão no sessionStorage para sobreviver a refresh/troca de aba
    const CONFIRMED_SESSION_KEY = 'audit_confirmed_session_id';
    const [dbSessionId, setDbSessionId] = useState<string | undefined>(
        () => sessionStorage.getItem(CONFIRMED_SESSION_KEY) || undefined
    );
    const [isUpdatingStock, setIsUpdatingStock] = useState(false);
    const PARTIAL_EXPIRED_ALERT_KEY = useMemo(
        () => `audit_partial_expired_alert_${dbSessionId || selectedFilial || 'unknown'}`,
        [dbSessionId, selectedFilial]
    );

    const lastAuditUpdateRef = useRef<string | null>(null);
    const activeFilialRef = useRef<string>('');

    useEffect(() => {
        activeFilialRef.current = selectedFilial || '';
    }, [selectedFilial]);

    const loadAuditNum = useCallback(async (silent: boolean = false) => {
        if (!selectedFilial) return;
        const requestedFilial = selectedFilial;
        const isStaleRequest = () => activeFilialRef.current !== requestedFilial;
        try {
            let forceFreshFetch = false;
            // Se for polling silencioso, busca apenas metadados para economizar banda e processamento
            if (silent) {
                const meta = await fetchLatestAuditMetadata(selectedFilial);
                if (!meta || isStaleRequest()) return;

                // Se a data de atualização for a mesma, não faz nada
                if (lastAuditUpdateRef.current === meta.updated_at) {
                    return;
                }

                lastAuditUpdateRef.current = meta.updated_at;
                forceFreshFetch = true;
            }

            const cacheKey = `audit_session_${selectedFilial}`;
            const backupKey = `audit_session_lastgood_${selectedFilial}`;
            const latestFromDb = await fetchLatestAudit(selectedFilial);
            if (latestFromDb) {
                await CacheService.set(cacheKey, latestFromDb as any);
                if (latestFromDb.data && getAuditDataStrength(latestFromDb.data as AuditData) > 0) {
                    await CacheService.set(backupKey, latestFromDb as any);
                }
            }
            const cachedCurrent = !silent ? await CacheService.get<DbAuditSession>(cacheKey) : null;
            const cachedBackup = await CacheService.get<DbAuditSession>(backupKey);

            let latest: DbAuditSession | null = null;
            if (latestFromDb) {
                // Security-first: trust the latest server snapshot and use cache only as fallback.
                // This avoids resurrecting stale partial scopes/terms from local backups.
                latest = latestFromDb;
            } else {
                const fallbackCandidates = [cachedCurrent, cachedBackup].filter(Boolean) as DbAuditSession[];
                if (fallbackCandidates.length > 0) {
                    latest = fallbackCandidates.sort((a, b) => {
                        if (a.audit_number !== b.audit_number) return b.audit_number - a.audit_number;
                        const aTs = new Date(a.updated_at || 0).getTime();
                        const bTs = new Date(b.updated_at || 0).getTime();
                        if (aTs !== bTs) return bTs - aTs;
                        const aStrength = getAuditDataStrength((a.data as AuditData) || null);
                        const bStrength = getAuditDataStrength((b.data as AuditData) || null);
                        return bStrength - aStrength;
                    })[0];
                }
            }

            // Polling silencioso com mesma sessão → atualiza dados sem popups
            if (isStaleRequest()) return;
            if (silent && latest && dbSessionId === latest.id && latest.data) {
                lastAuditUpdateRef.current = latest.updated_at || null;
                // Normaliza e aplica os dados frescos do banco para todos os usuários
                if ((latest.data as any).partialStart && !(latest.data as any).partialStarts) {
                    (latest.data as any).partialStarts = [(latest.data as any).partialStart];
                }
                if (!(latest.data as any).partialCompleted) {
                    (latest.data as any).partialCompleted = [];
                }
                if ((latest.data as any).partialCompleted) {
                    const deduped = new Map<string, any>();
                    (latest.data as any).partialCompleted.forEach((p: any) => {
                        deduped.set(partialCompletedKey(p), p);
                    });
                    (latest.data as any).partialCompleted = Array.from(deduped.values());
                }
                if (latest.data.groups) {
                    latest.data.groups.forEach((g: any) => {
                        g.departments.forEach((d: any) => {
                            d.categories.forEach((c: any) => {
                                c.status = normalizeAuditStatus(c.status);
                                if (c.totalCost === undefined || c.totalCost === null || (c.totalCost === 0 && c.totalQuantity > 0)) {
                                    let catCost = 0;
                                    c.products.forEach((p: any) => { catCost += (p.quantity * (p.cost || 0)); });
                                    c.totalCost = catCost;
                                }
                            });
                        });
                    });
                }
                const reconciled = reconcileAuditStateFromCompletedScopes(latest.data as AuditData);
                setData(reconciled);
                setTermDrafts(((reconciled as any).termDrafts || {}) as Record<string, TermForm>);
                if (getAuditDataStrength(reconciled) > 0) {
                    await CacheService.set(backupKey, { ...latest, data: reconciled } as any);
                }
                return; // Dados atualizados silenciosamente, sem popups
            }

            if (isStaleRequest()) return;
            if (latest && latest.status !== 'completed') {
                setNextAuditNumber(latest.audit_number);
                setDbSessionId(latest.id);

                if (latest.data) {
                    if (isStaleRequest()) return;
                    if ((latest.data as any).partialStart && !(latest.data as any).partialStarts) {
                        (latest.data as any).partialStarts = [(latest.data as any).partialStart];
                    }
                    if (!(latest.data as any).partialCompleted) {
                        (latest.data as any).partialCompleted = [];
                    }
                    if ((latest.data as any).partialCompleted) {
                        const deduped = new Map<string, any>();
                        (latest.data as any).partialCompleted.forEach((p: any) => {
                            deduped.set(partialCompletedKey(p), p);
                        });
                        (latest.data as any).partialCompleted = Array.from(deduped.values());
                    }

                    if (!(latest.data as any).lastPartialBatchId) {
                        (latest.data as any).lastPartialBatchId = getLatestBatchId((latest.data as any).partialCompleted);
                    }
                    // REPAIR LOGIC: If totalCost is missing (old sessions), recalculate it
                    if (latest.data.groups) {
                        latest.data.groups.forEach((g: any) => {
                            g.departments.forEach((d: any) => {
                                d.categories.forEach((c: any) => {
                                    c.status = normalizeAuditStatus(c.status);
                                    if (c.totalCost === undefined || c.totalCost === null || (c.totalCost === 0 && c.totalQuantity > 0)) {
                                        let catCost = 0;
                                        c.products.forEach((p: any) => {
                                            catCost += (p.quantity * (p.cost || 0));
                                        });
                                        c.totalCost = catCost;
                                    }
                                });
                            });
                        });
                    }
                    const reconciled = reconcileAuditStateFromCompletedScopes(latest.data as AuditData);
                    setData(reconciled);
                    const draftsFromData = ((reconciled as any).termDrafts || {}) as Record<string, TermForm>;
                    setTermDrafts(draftsFromData);
                    if (getAuditDataStrength(reconciled) > 0) {
                        await CacheService.set(backupKey, { ...latest, data: reconciled } as any);
                    }
                    setDbSessionId(latest.id);

                    if (!silent) {
                        const isNewSession = dbSessionId !== latest.id;
                        // Sessão já confirmada nesta janela do browser (sobrevive a refresh)
                        const alreadyConfirmed = sessionStorage.getItem(CONFIRMED_SESSION_KEY) === latest.id;

                        if (isMaster) {
                            if ((isNewSession || !data) && !alreadyConfirmed) {
                                const wantsToUpdate = window.confirm(`Auditoria Nº ${latest.audit_number} em aberto encontrada.\n\nDeseja abrir a tela para carregar um NOVO arquivo de SALDOS para atualizar o estoque pendente?`);
                                if (wantsToUpdate) {
                                    setIsUpdatingStock(true);
                                    setGroupFiles(createInitialGroupFiles());
                                    setFileDeptIds(null);
                                    setFileCatIds(null);
                                    setFileStock(null);
                                } else {
                                    setIsUpdatingStock(false);
                                }
                            }
                            // Marca esta sessão como confirmada para não perguntar novamente
                            if (latest.id) sessionStorage.setItem(CONFIRMED_SESSION_KEY, latest.id);
                            setView({ level: 'groups' });
                        } else {
                            setIsUpdatingStock(false);
                            setView({ level: 'groups' });

                            if ((isNewSession || !data) && !alreadyConfirmed) {
                                const lastLoadStr = latest.updated_at ? new Date(latest.updated_at).toLocaleString('pt-BR') : 'não informada';
                                alert(`ENTRANDO EM MODO CONSULTA.\n\nAviso: O estoque exibido reflete a última carga realizada pelo usuário Master em ${lastLoadStr} e pode estar desatualizado.`);
                            }
                            // Marca como confirmada
                            if (latest.id) sessionStorage.setItem(CONFIRMED_SESSION_KEY, latest.id);
                        }
                    } else if (!data && !isUpdatingStock) {
                        // Se for polling mas não estávamos em uma auditoria, entra automaticamente
                        setView({ level: 'groups' });
                    }

                    let done = 0;
                    if (latest.data.groups) {
                        latest.data.groups.forEach((g: any) =>
                            g.departments.forEach((d: any) =>
                                d.categories.forEach((c: any) => {
                                    if (isDoneStatus(c.status)) done += c.totalQuantity;
                                })
                            )
                        );
                    }
                    setInitialDoneUnits(done);
                }
            } else {
                // Se a API retornou null e estamos em polling, só fechamos a auditoria se tivermos certeza.
                // Mas como o fetchLatestAudit pode retornar null em erros de rede (500), vamos ser menos agressivos:
                // Só alertar se não houver erro. O `latest` ser null aqui pode ser um falso negativo de conexão caída.
                if (latest !== undefined) {
                    if (isStaleRequest()) return;
                    setNextAuditNumber(latest ? latest.audit_number + 1 : 1);
                    setDbSessionId(undefined);
                    if (!silent) {
                        setData(null);
                        setTermDrafts({});
                    } else if (data) {
                        // Evita limpar sessão local se foi só um erro 500 passageiro.
                        // Só desloga se explicitamente a session de fechamento for retornada ou sumiu.
                        // Mas por segurança, como não temos como distinguir no payload atual entre "Nao tem" e "Deu erro 500"
                        // se o fetch silencia erros, deixamos o usuário trabalhar offline localmente até salvar.
                    }
                }
            }
        } catch (error) {
            console.error('Error loading audit info:', error);
            // Em caso de erro de conexão, NÃO expulsa o usuário.
        }
    }, [selectedFilial, dbSessionId, isMaster, data, isUpdatingStock]);

    // Carga Inicial
    useEffect(() => {
        setData(null);
        setTermDrafts({});
        setDbSessionId(undefined);
        setIsUpdatingStock(false);
        setTermModal(null);
        setTermForm(null);
        setTermComparisonMetrics(null);
        removedExcelDraftKeysRef.current.clear();
        lastAuditUpdateRef.current = null;
        if (selectedFilial) {
            loadAuditNum();
        }
    }, [selectedFilial]);

    // Polling de sincronização entre usuários
    useEffect(() => {
        if (!selectedFilial) return;
        const syncNow = () => loadAuditNum(true);

        // Aba ativa: sincroniza rápido. Aba oculta: reduz frequência para economizar.
        const getIntervalMs = () => (document.hidden ? 12000 : 5000);
        let interval = setInterval(syncNow, getIntervalMs());

        const resetInterval = () => {
            clearInterval(interval);
            interval = setInterval(syncNow, getIntervalMs());
        };

        const handleVisibilityOrFocus = () => {
            resetInterval();
            if (!document.hidden) {
                syncNow();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        window.addEventListener('focus', handleVisibilityOrFocus);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
            window.removeEventListener('focus', handleVisibilityOrFocus);
        };
    }, [selectedFilial, loadAuditNum]);

    // Derived inventory number (Auto-generated)
    const inventoryNumber = useMemo(() => {
        return selectedFilial ? `${new Date().getFullYear()}-${selectedFilial.padStart(4, '0')}-${String(nextAuditNumber).padStart(4, '0')}` : '';
    }, [selectedFilial, nextAuditNumber]);

    // Dummy setter to keep existing logic working without massive refactor
    const setInventoryNumber = (val: string) => { };

    const [groupFiles, setGroupFiles] = useState<Record<GroupUploadId, File | null>>(createInitialGroupFiles);
    const [fileStock, setFileStock] = useState<File | null>(null);
    const [fileDeptIds, setFileDeptIds] = useState<File | null>(null);
    const [fileCatIds, setFileCatIds] = useState<File | null>(null);
    const [globalGroupFiles, setGlobalGroupFiles] = useState<Record<GroupUploadId, File | null>>(createInitialGroupFiles);
    const [globalGroupMeta, setGlobalGroupMeta] = useState<Record<GroupUploadId, DbGlobalBaseFile | null>>(createInitialGroupMeta);
    const [globalDeptIdsFile, setGlobalDeptIdsFile] = useState<File | null>(null);
    const [globalCatIdsFile, setGlobalCatIdsFile] = useState<File | null>(null);
    const [globalDeptIdsMeta, setGlobalDeptIdsMeta] = useState<DbGlobalBaseFile | null>(null);
    const [globalCatIdsMeta, setGlobalCatIdsMeta] = useState<DbGlobalBaseFile | null>(null);
    const [isLoadingGlobalBases, setIsLoadingGlobalBases] = useState(false);

    const localGroupFilesCount = useMemo(
        () => GROUP_UPLOAD_IDS.reduce((count, groupId) => count + (groupFiles[groupId] ? 1 : 0), 0),
        [groupFiles]
    );

    const effectiveGroupFiles = useMemo(
        () =>
            GROUP_UPLOAD_IDS
                .map(groupId => ({ groupId, file: groupFiles[groupId] || globalGroupFiles[groupId] }))
                .filter((entry): entry is { groupId: GroupUploadId; file: File } => !!entry.file),
        [groupFiles, globalGroupFiles]
    );

    const effectiveDeptIdsFile = fileDeptIds || globalDeptIdsFile;
    const effectiveCatIdsFile = fileCatIds || globalCatIdsFile;
    const setGroupFile = (groupId: GroupUploadId, file: File | null) => {
        setGroupFiles(prev => ({ ...prev, [groupId]: file }));
    };

    const formatGlobalTimestamp = useCallback((value?: string | null) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('pt-BR');
    }, []);

    useEffect(() => {
        const companyId = selectedCompany?.id;
        if (!companyId) {
            setGlobalGroupFiles(createInitialGroupFiles());
            setGlobalGroupMeta(createInitialGroupMeta());
            setGlobalDeptIdsFile(null);
            setGlobalCatIdsFile(null);
            setGlobalDeptIdsMeta(null);
            setGlobalCatIdsMeta(null);
            setIsLoadingGlobalBases(false);
            return;
        }

        let cancelled = false;
        const loadGlobalAuditBases = async () => {
            setIsLoadingGlobalBases(true);
            try {
                const keysToFetch = [
                    ...GROUP_UPLOAD_IDS.map(groupId => GROUP_GLOBAL_BASE_KEYS[groupId]),
                    AUDIT_DEPT_IDS_GLOBAL_KEY,
                    AUDIT_CAT_IDS_GLOBAL_KEY
                ];
                const files = [];
                for (const key of keysToFetch) {
                    if (cancelled) break;
                    const file = await CadastrosBaseService.getGlobalBaseFileCached(companyId, key);
                    files.push(file);
                }
                if (cancelled) return;

                const byKey = new Map();
                files.forEach(file => {
                    if (file) byKey.set(file.module_key, file);
                });
                const nextGroupFiles = createInitialGroupFiles();
                const nextGroupMeta = createInitialGroupMeta();

                GROUP_UPLOAD_IDS.forEach(groupId => {
                    const moduleKey = GROUP_GLOBAL_BASE_KEYS[groupId];
                    const globalFile = byKey.get(moduleKey) || null;
                    nextGroupMeta[groupId] = globalFile;
                    if (globalFile) {
                        nextGroupFiles[groupId] = decodeGlobalFileToBrowserFile(globalFile);
                    }
                });

                const deptMeta = byKey.get(AUDIT_DEPT_IDS_GLOBAL_KEY) || null;
                const catMeta = byKey.get(AUDIT_CAT_IDS_GLOBAL_KEY) || null;

                setGlobalGroupFiles(nextGroupFiles);
                setGlobalGroupMeta(nextGroupMeta);
                setGlobalDeptIdsMeta(deptMeta);
                setGlobalCatIdsMeta(catMeta);
                setGlobalDeptIdsFile(deptMeta ? decodeGlobalFileToBrowserFile(deptMeta) : null);
                setGlobalCatIdsFile(catMeta ? decodeGlobalFileToBrowserFile(catMeta) : null);
            } catch (error) {
                console.error('Erro ao carregar bases globais da auditoria:', error);
                if (!cancelled) {
                    setGlobalGroupFiles(createInitialGroupFiles());
                    setGlobalGroupMeta(createInitialGroupMeta());
                    setGlobalDeptIdsMeta(null);
                    setGlobalCatIdsMeta(null);
                    setGlobalDeptIdsFile(null);
                    setGlobalCatIdsFile(null);
                }
            } finally {
                if (!cancelled) setIsLoadingGlobalBases(false);
            }
        };

        loadGlobalAuditBases();
        return () => {
            cancelled = true;
        };
    }, [selectedCompany?.id]);

    useEffect(() => {
        AuditStorage.cleanupLegacyAuditStorage();

        const loadLocal = async () => {
            const savedData = await AuditStorage.loadLocalAuditSession();
            if (savedData) {
                // Restoration of basic settings - but let loadAuditNum fetch full fresh context usually.
                // However, we can use savedData if Supabase fails.
                if (savedData.filial) setSelectedFilial(savedData.filial);
                if (savedData.inventoryNumber) setInventoryNumber(savedData.inventoryNumber);
            }
        };
        loadLocal();
    }, []);


    useEffect(() => {
        if (data) {
            AuditStorage.saveLocalAuditSession(data);
        }
    }, [data]);

    const persistAuditSession = useCallback(async (
        session: DbAuditSession,
        options?: { allowProgressRegression?: boolean }
    ): Promise<DbAuditSession | null> => {
        const branch = String(session.branch || '');
        if (!branch || !session.audit_number) return null;

        const latestMeta = await fetchLatestAuditMetadata(branch);
        const baseUpdatedAt = session.updated_at || lastAuditUpdateRef.current || null;
        const isSameAudit = !!latestMeta && latestMeta.audit_number === session.audit_number;
        const allowProgressRegression = !!options?.allowProgressRegression;

        const freshLatest = isSameAudit ? await fetchLatestAudit(branch) : null;
        const incomingData = (session.data as AuditData) || null;
        const incomingStrength = getAuditDataStrength(incomingData);
        const remoteStrength = getAuditDataStrength((freshLatest?.data as AuditData) || null);
        const incomingGroupsCount = Array.isArray(incomingData?.groups) ? incomingData.groups.length : 0;
        const incomingProgress = Number(session.progress || 0);
        if (
            !allowProgressRegression &&
            freshLatest &&
            freshLatest.audit_number === session.audit_number &&
            remoteStrength > 0 &&
            incomingStrength < remoteStrength &&
            (incomingStrength <= 0 || incomingGroupsCount === 0 || incomingProgress <= 0.1)
        ) {
            const recovered = reconcileAuditStateFromCompletedScopes(freshLatest.data as AuditData);
            setData(recovered);
            setTermDrafts(((recovered as any).termDrafts || {}) as Record<string, TermForm>);
            setDbSessionId(freshLatest.id);
            setNextAuditNumber(freshLatest.audit_number);
            lastAuditUpdateRef.current = freshLatest.updated_at || latestMeta?.updated_at || null;
            await CacheService.set(`audit_session_${branch}`, { ...freshLatest, data: recovered } as any);
            await CacheService.set(`audit_session_lastgood_${branch}`, { ...freshLatest, data: recovered } as any);
            alert("Bloqueamos uma sobrescrita de dados parciais para proteger os dados já gravados.");
            return null;
        }
        if (
            !allowProgressRegression &&
            freshLatest &&
            freshLatest.audit_number === session.audit_number &&
            incomingProgress <= 0.1 &&
            Number(freshLatest.progress || 0) >= 1 &&
            incomingProgress + 0.001 < Number(freshLatest.progress || 0)
        ) {
            if (freshLatest?.data) {
                const recovered = reconcileAuditStateFromCompletedScopes(freshLatest.data as AuditData);
                setData(recovered);
                setTermDrafts(((recovered as any).termDrafts || {}) as Record<string, TermForm>);
                setDbSessionId(freshLatest.id);
                setNextAuditNumber(freshLatest.audit_number);
                lastAuditUpdateRef.current = freshLatest.updated_at || latestMeta?.updated_at || null;
                await CacheService.set(`audit_session_${branch}`, { ...freshLatest, data: recovered } as any);
            }
            alert("Bloqueamos uma sobrescrita de progresso antigo para proteger contagens finalizadas.");
            return null;
        }

        if (isSameAudit && latestMeta?.updated_at && baseUpdatedAt) {
            const remoteTs = new Date(latestMeta.updated_at).getTime();
            const baseTs = new Date(baseUpdatedAt).getTime();
            if (Number.isFinite(remoteTs) && Number.isFinite(baseTs) && remoteTs > baseTs + 1000) {
                const fresh = freshLatest || await fetchLatestAudit(branch);
                if (fresh?.data) {
                    const recovered = reconcileAuditStateFromCompletedScopes(fresh.data as AuditData);
                    setData(recovered);
                    setTermDrafts(((recovered as any).termDrafts || {}) as Record<string, TermForm>);
                    setDbSessionId(fresh.id);
                    setNextAuditNumber(fresh.audit_number);
                    lastAuditUpdateRef.current = fresh.updated_at || latestMeta.updated_at || null;
                    await CacheService.set(`audit_session_${branch}`, { ...fresh, data: recovered } as any);
                    await CacheService.set(`audit_session_lastgood_${branch}`, { ...fresh, data: recovered } as any);
                }
                alert("A auditoria foi atualizada por outro usuário/aba. Recarregamos os dados mais novos para evitar sobrescrita.");
                return null;
            }
        }

        const saved = await upsertAuditSession({
            ...session,
            updated_at: baseUpdatedAt || undefined
        });
        if (saved?.updated_at) {
            lastAuditUpdateRef.current = saved.updated_at;
            const reconciled = saved.data ? reconcileAuditStateFromCompletedScopes(saved.data as AuditData) : null;
            if (reconciled && getAuditDataStrength(reconciled) > 0) {
                await CacheService.set(`audit_session_lastgood_${branch}`, { ...saved, data: reconciled } as any);
            }
        }
        return saved;
    }, []);

    const handleSafeExit = async () => {
        const resetAuditUi = () => {
            sessionStorage.removeItem(CONFIRMED_SESSION_KEY);
            setData(null);
            setDbSessionId(undefined);
            setSelectedFilial("");
            setGroupFiles(createInitialGroupFiles());
            setFileStock(null);
            setFileDeptIds(null);
            setFileCatIds(null);
            setInitialDoneUnits(0);
            setSessionStartTime(Date.now());
            setView({ level: 'groups' });
        };

        if (!selectedFilial) {
            resetAuditUi();
            return;
        }

        // Se não for Master, não precisa confirmar nem salvar (já que não salvou nada)
        if (!isMaster) {
            resetAuditUi();
            void AuditStorage.clearLocalAuditSession();
            return;
        }

        if (window.confirm("Deseja sair da auditoria? Seu progresso será salvo automaticamente e você poderá retomar depois.")) {
            const snapshotData = data
                ? ({ ...data, termDrafts: ((data as any)?.termDrafts || termDrafts || {}) } as any)
                : null;
            const snapshotSessionId = dbSessionId;
            const snapshotBranch = selectedFilial;
            const snapshotAudit = nextAuditNumber;
            const snapshotProgress = data ? calculateProgress(data) : 0;

            // Fecha imediatamente; persistência roda em background.
            resetAuditUi();

            if (!snapshotData || !snapshotBranch) return;

            void (async () => {
                try {
                    const savedSession = await persistAuditSession({
                        id: snapshotSessionId,
                        branch: snapshotBranch,
                        audit_number: snapshotAudit,
                        status: 'open',
                        data: snapshotData,
                        progress: snapshotProgress,
                        user_email: userEmail
                    });
                    if (savedSession) {
                        await CacheService.set(`audit_session_${snapshotBranch}`, savedSession as any);
                        await AuditStorage.clearLocalAuditSession();
                    }
                } catch (err) {
                    console.error("Error saving session in background:", err);
                }
            })();
        }
    };

    const handleFinishAudit = async () => {
        if (!data) return;

        const progress = calculateProgress(data);

        if (progress < 100) {
            alert("A auditoria ainda não está 100% completa. Verifique os itens pendentes.");
            return;
        }

        if (window.confirm(`ATENÇÃO: Você está prestes a FINALIZAR a auditoria Nº ${nextAuditNumber}.\n\nIsso irá concluir o processo e não permitirá mais edições.\n\nDeseja continuar?`)) {
            try {
                setIsProcessing(true);
                const savedSession = await persistAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'completed',
                    data: { ...data, termDrafts: ((data as any)?.termDrafts || termDrafts || {}) } as any,
                    progress: 100,
                    user_email: userEmail
                });
                if (savedSession) {
                    await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
                }

                alert("Auditoria finalizada com sucesso!");

                // Clear local view state to 'exit'
                await AuditStorage.clearLocalAuditSession();
                sessionStorage.removeItem(CONFIRMED_SESSION_KEY);
                setData(null);
                setDbSessionId(undefined);
                setSelectedFilial("");
                setGroupFiles(createInitialGroupFiles());
                setFileStock(null);
                setFileDeptIds(null);
                setFileCatIds(null);
                setInitialDoneUnits(0);
                setSessionStartTime(Date.now());
                setView({ level: 'groups' });
            } catch (err) {
                console.error("Error finishing session:", err);
                alert("Erro ao finalizar auditoria. Tente novamente.");
            } finally {
                setIsProcessing(false);
            }
        }
    };

    const normalizeBarcode = (val: any): string => {
        if (val === null || val === undefined) return "";
        if (typeof val === 'number' && Number.isFinite(val)) {
            return String(Math.trunc(val)).replace(/^0+/, "");
        }
        let s = val.toString().trim();
        if (s.includes('E+') || s.includes('e+')) {
            s = Number(val).toLocaleString('fullwide', { useGrouping: false });
        }
        if (/^\d+[.,]0+$/.test(s)) s = s.split(/[.,]/)[0];
        return s.replace(/\D/g, "").replace(/^0+/, "");
    };

    const parseStockNumber = (val: any): number => {
        return Number(parseDecimalCell(val));
    };

    const normalizeText = (text?: string) => {
        if (!text) return '';
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    };

    const parseDecimalCell = (val: any): number => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
        const raw = String(val).trim();
        if (!raw) return 0;
        let s = raw.replace(/\s+/g, '');
        if (s.includes('.') && s.includes(',')) {
            s = s.lastIndexOf(',') > s.lastIndexOf('.')
                ? s.replace(/\./g, '').replace(',', '.')
                : s.replace(/,/g, '');
        } else if (s.includes(',')) {
            s = /,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
        } else if ((s.match(/\./g) || []).length > 1) {
            s = s.replace(/\./g, '');
        }
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
    };

    const readExcel = (file: File): Promise<any[][]> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const ab = e.target?.result;
                    const XLSX = (window as any).XLSX;
                    if (!XLSX) {
                        reject(new Error("Biblioteca XLSX não encontrada."));
                        return;
                    }
                    const workbook = XLSX.read(ab, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                    resolve(rows as any[][]);
                } catch (err) { reject(err); }
            };
            reader.readAsArrayBuffer(file);
        });
    };

    const cleanDescription = (str: string) => {
        if (!str) return "";
        return str.toString().replace(/^[0-9\s\-\.]+/, "").trim().toUpperCase();
    };

    const toUploadedFileMeta = (file: File | null) => {
        if (!file) return null;
        return {
            name: file.name,
            size: file.size,
            type: file.type || null,
            lastModified: file.lastModified
        };
    };

    const buildStructureSourceMeta = () => {
        const nowIso = new Date().toISOString();
        return {
            mode: 'initial-structure-import',
            importedAt: nowIso,
            groups: effectiveGroupFiles.map(({ groupId, file }) => ({
                groupId,
                source: groupFiles[groupId] ? 'local_upload' : 'global_base',
                file: toUploadedFileMeta(file),
                syncedAt: globalGroupMeta[groupId]?.updated_at || globalGroupMeta[groupId]?.uploaded_at || null
            })),
            stock: toUploadedFileMeta(fileStock),
            deptIds: effectiveDeptIdsFile ? {
                ...toUploadedFileMeta(effectiveDeptIdsFile),
                source: fileDeptIds ? 'local_upload' : (globalDeptIdsMeta ? 'global_base' : 'none'),
                syncedAt: globalDeptIdsMeta?.updated_at || globalDeptIdsMeta?.uploaded_at || null
            } : null,
            catIds: effectiveCatIdsFile ? {
                ...toUploadedFileMeta(effectiveCatIdsFile),
                source: fileCatIds ? 'local_upload' : (globalCatIdsMeta ? 'global_base' : 'none'),
                syncedAt: globalCatIdsMeta?.updated_at || globalCatIdsMeta?.uploaded_at || null
            } : null
        };
    };

    const handleStartAudit = async () => {
        if (!selectedFilial) {
            alert("Selecione a filial.");
            return;
        }

        const hasStructureFiles = effectiveGroupFiles.length > 0;
        const hasLocalStructureFiles = localGroupFilesCount > 0;
        const hasOpenStructure = !!(data && data.groups && data.groups.length > 0);
        const shouldMergeStockOnly = hasOpenStructure;
        const shouldReclassifyOpen = hasOpenStructure && hasStructureFiles;
        const mergePreservingDone = (baseData: AuditData, rebuiltData: AuditData): AuditData => {
            const merged: AuditData = {
                ...rebuiltData,
                termDrafts: baseData.termDrafts,
                partialStarts: baseData.partialStarts,
                partialCompleted: baseData.partialCompleted,
                lastPartialBatchId: baseData.lastPartialBatchId,
                groups: rebuiltData.groups.map(g => ({
                    ...g,
                    departments: g.departments.map(d => ({ ...d, categories: [...d.categories] }))
                }))
            };
            const ensureGroup = (groupId: string, groupName: string) => {
                let g = merged.groups.find(x => String(x.id) === String(groupId));
                if (!g) {
                    g = { id: groupId, name: groupName, departments: [] };
                    merged.groups.push(g);
                }
                return g;
            };
            const ensureDept = (group: Group, dept: Department) => {
                const deptIdentity = dept.id || dept.name;
                let d = group.departments.find(x => x.id === deptIdentity || x.name === dept.name);
                if (!d) {
                    d = { ...dept, categories: [] };
                    group.departments.push(d);
                }
                return d;
            };

            baseData.groups.forEach(oldGroup => {
                oldGroup.departments.forEach(oldDept => {
                    oldDept.categories.forEach(oldCat => {
                        if (!isDoneStatus(oldCat.status)) return;
                        const group = ensureGroup(String(oldGroup.id), oldGroup.name);
                        const dept = ensureDept(group, oldDept);
                        const catId = oldCat.id;
                        const idx = dept.categories.findIndex(c => c.id === catId || c.name === oldCat.name);
                        if (idx >= 0) dept.categories[idx] = { ...oldCat };
                        else dept.categories.push({ ...oldCat });
                    });
                });
            });
            return merged;
        };

        if (!fileStock) {
            alert("Por favor, carregue o arquivo de SALDOS.");
            return;
        }

        if (!shouldMergeStockOnly && !hasStructureFiles) {
            alert("Por favor, carregue ao menos um arquivo de CADASTRO por grupo para classificar a estrutura.");
            return;
        }

        if (shouldMergeStockOnly && !data) {
            alert("Não existe auditoria aberta para atualizar apenas saldos.");
            return;
        }

        if (shouldReclassifyOpen && data) {
            if (!window.confirm("Reclassificar a estrutura aberta com os novos arquivos carregados?")) {
                return;
            }
        } else if (!shouldMergeStockOnly) {
            if (!window.confirm(`ATENÇÃO: Você está prestes a criar um NOVO inventário (Nº ${nextAuditNumber}) para a Filial ${selectedFilial}.\n\nDeseja realmente prosseguir?`)) {
                return;
            }
        }

        setIsProcessing(true);
        try {
            const safePartialStarts = Array.isArray(data?.partialStarts) ? data.partialStarts : [];

            if (shouldMergeStockOnly && data && !shouldReclassifyOpen) {
                // Lógica de MERGE de estoque
                const rowsStock = await readExcel(fileStock!);
                const stockAcc: Record<string, { q: number; costAmount: number }> = {};
                rowsStock.forEach(row => {
                    if (!row) return;
                    const reduced = normalizeBarcode(row[1]); // B (reduzido)
                    if (!reduced) return;
                    const q = parseStockNumber(row[14]); // O
                    const c = parseStockNumber(row[15]); // P
                    if (q <= 0) return;
                    const prev = stockAcc[reduced] || { q: 0, costAmount: 0 };
                    stockAcc[reduced] = {
                        q: prev.q + q,
                        costAmount: prev.costAmount + (q * c)
                    };
                });
                const stockMap: Record<string, { q: number; c: number }> = {};
                Object.entries(stockAcc).forEach(([reduced, acc]) => {
                    stockMap[reduced] = {
                        q: acc.q,
                        c: acc.q > 0 ? (acc.costAmount / acc.q) : 0
                    };
                });

                const newData = { ...data };
                let appliedUnits = 0;
                const matchedReduced = new Set<string>();
                newData.groups.forEach(g => {
                    g.departments.forEach(d => {
                        d.categories.forEach(c => {
                            if (!isDoneStatus(c.status)) {
                                c.totalQuantity = 0;
                                c.totalCost = 0;
                                c.products.forEach(p => {
                                    const reduced = normalizeBarcode(p.reducedCode || p.code);
                                    const entry = stockMap[reduced] || { q: 0, c: 0 };
                                    p.quantity = entry.q;
                                    p.cost = entry.c;
                                    c.totalQuantity += entry.q;
                                    c.totalCost += (entry.q * entry.c);
                                    appliedUnits += entry.q;
                                    if (entry.q > 0 && reduced) matchedReduced.add(reduced);
                                });
                            }
                        });
                    });
                });
                const stockUnits = Object.values(stockMap).reduce((sum, e) => sum + e.q, 0);
                let unmatchedUnits = 0;
                Object.entries(stockMap).forEach(([reduced, entry]) => {
                    if (!matchedReduced.has(reduced)) unmatchedUnits += entry.q;
                });
                if (Math.abs(stockUnits - appliedUnits) > 0.01 || unmatchedUnits > 0.01) {
                    alert(`Reconciliação do estoque:\nArquivo: ${Math.round(stockUnits).toLocaleString()} unid.\nAplicado: ${Math.round(appliedUnits).toLocaleString()} unid.\nNão classificados: ${Math.round(unmatchedUnits).toLocaleString()} unid.`);
                }

                const nowIso = new Date().toISOString();
                const prevSourceFiles = ((data as any).sourceFiles || {}) as any;
                const stockMeta = toUploadedFileMeta(fileStock);
                const stockUpdates = Array.isArray(prevSourceFiles.stockUpdates) ? prevSourceFiles.stockUpdates : [];
                const nextSourceFiles = {
                    ...prevSourceFiles,
                    stock: stockMeta,
                    lastStockUpdateAt: nowIso,
                    stockUpdates: [
                        ...stockUpdates,
                        { ...stockMeta, updatedAt: nowIso }
                    ]
                };
                const preservedTermDrafts = ((data as any).termDrafts || termDrafts || {}) as Record<string, any>;
                const basePersistedData = { ...newData, termDrafts: preservedTermDrafts, sourceFiles: nextSourceFiles } as any;
                const persistedData = applyPartialScopes(basePersistedData, safePartialStarts);
                const progress = calculateProgress(persistedData as AuditData);
                const savedSession = await persistAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'open',
                    data: persistedData,
                    progress: progress,
                    user_email: userEmail
                });
                if (!savedSession) {
                    throw new Error("Falha ao salvar atualização de saldos no Supabase.");
                }

                setDbSessionId(savedSession.id);
                setNextAuditNumber(savedSession.audit_number);
                setTermDrafts(preservedTermDrafts as any);
                setData((savedSession.data as AuditData) || (persistedData as AuditData));
                setGroupFiles(createInitialGroupFiles());
                setFileDeptIds(null);
                setFileCatIds(null);
                setFileStock(null);
                setIsUpdatingStock(false);
                setView({ level: 'groups' });
                alert("Estoques atualizados (apenas para itens não finalizados).");
                return;
            }

            if (!hasStructureFiles) {
                alert("Carregue arquivos de CADASTRO por grupo para reclassificar.");
                return;
            }

            const rowsGroupsByFile = await Promise.all(effectiveGroupFiles.map(entry => readExcel(entry.file)));
            const rowsStock = await readExcel(fileStock);

            type ProductScope = { groupId: string; groupName: string; deptId: string; deptName: string; catId: string; catName: string };
            const productsByReduced: Record<string, ProductScope[]> = {};
            const productsByName: Record<string, ProductScope[]> = {};
            const catReportByReduced: Record<string, { catId: string; catName: string; deptName: string }> = {};
            const deptReportByReduced: Record<string, { deptId: string; deptName: string }> = {};
            const deptIdByDescription: Record<string, string> = {};
            const catIdByDescription: Record<string, string> = {};
            const deptDescEntries: Array<{ key: string; id: string }> = [];
            const catDescEntries: Array<{ key: string; id: string }> = [];

            const normalizeDescriptionKey = (value: unknown) =>
                normalizeLookupText(cleanDescription(String(value ?? '')));

            const fillIdByDescription = (
                rows: any[][],
                output: Record<string, string>,
                entries: Array<{ key: string; id: string }>
            ) => {
                rows.forEach(row => {
                    if (!row) return;
                    const idNum = parseSheetNumericCode(row[5]); // F = numero
                    const descKey = normalizeDescriptionKey(row[7]); // H = descricao
                    if (idNum === null || !descKey) return;
                    if (!output[descKey]) output[descKey] = String(idNum);
                    entries.push({ key: descKey, id: String(idNum) });
                });
            };

            const resolveIdByDescription = (
                rawDesc: unknown,
                map: Record<string, string>,
                entries: Array<{ key: string; id: string }>
            ) => {
                const key = normalizeDescriptionKey(rawDesc);
                if (!key) return '';
                if (map[key]) return map[key];
                // Fallback tolerante para descricoes com sufixos/prefixos nos relatorios.
                const candidates = entries.filter(e =>
                    e.key === key ||
                    e.key.includes(key) ||
                    key.includes(e.key)
                );
                if (candidates.length === 1) return candidates[0].id;
                return '';
            };

            if (effectiveDeptIdsFile) {
                const rowsDept = await readExcel(effectiveDeptIdsFile);
                fillIdByDescription(rowsDept, deptIdByDescription, deptDescEntries);
                let lastDeptId = "";
                let lastDeptName = "";
                rowsDept.forEach(row => {
                    if (!row) return;
                    const deptIdNow = parseSheetNumericCode(row[5]); // F
                    if (deptIdNow !== null) lastDeptId = String(deptIdNow);
                    const deptNameNowRaw = String(row[7] ?? '').trim(); // H
                    if (deptNameNowRaw) lastDeptName = deptNameNowRaw.replace(/^\s*[-:/.]+\s*/, '').trim();
                    const reduced = normalizeBarcode(row[2]); // C
                    if (!reduced) return;
                    deptReportByReduced[reduced] = {
                        deptId: lastDeptId,
                        deptName: lastDeptName
                    };
                });
            }

            if (effectiveCatIdsFile) {
                const rowsCat = await readExcel(effectiveCatIdsFile);
                fillIdByDescription(rowsCat, catIdByDescription, catDescEntries);
                let lastCatId = "";
                let lastCatName = "";
                rowsCat.forEach(row => {
                    if (!row) return;
                    const catIdNow = parseSheetNumericCode(row[5]); // F
                    if (catIdNow !== null) lastCatId = String(catIdNow);
                    const catNameNowRaw = String(row[7] ?? '').trim(); // H
                    if (catNameNowRaw) lastCatName = catNameNowRaw.replace(/^\s*[-:/.]+\s*/, '').trim();
                    const reduced = normalizeBarcode(row[2]); // C
                    if (!reduced) return;
                    const deptName = String(row[19] ?? '').trim(); // T
                    catReportByReduced[reduced] = {
                        catId: lastCatId,
                        catName: lastCatName,
                        deptName
                    };
                });
            }

            const addScope = (bucket: Record<string, ProductScope[]>, key: string, scope: ProductScope) => {
                if (!key) return;
                const deptKey = scope.deptId || scope.deptName;
                const catKey = scope.catId || scope.catName;
                const scopeKey = `${scope.groupId}|${deptKey}|${catKey}`;
                const list = bucket[key] || [];
                if (!list.some(s => {
                    const existingDeptKey = s.deptId || s.deptName;
                    const existingCatKey = s.catId || s.catName;
                    return `${s.groupId}|${existingDeptKey}|${existingCatKey}` === scopeKey;
                })) {
                    list.push(scope);
                    bucket[key] = list;
                }
            };

            const groupFileRows = effectiveGroupFiles.map((entry, idx) => ({
                groupId: entry.groupId,
                rows: rowsGroupsByFile[idx] || []
            }));

            groupFileRows.forEach(({ groupId, rows }) => {
                const groupName = GROUP_CONFIG_DEFAULTS[groupId] || `Grupo ${groupId}`;

                rows.forEach((row) => {
                    if (!row || row.length < 4) return;

                    // Cadastro individual: C = reduzido, S = departamento, W = categoria
                    const reducedFromCadastro = normalizeBarcode(row[2]);
                    if (!reducedFromCadastro) return;
                    const productNameKey = cleanDescription(row[3]?.toString() || "");

                    const deptCell = parseHierarchyCell(row[18], "OUTROS");
                    const catCell = parseHierarchyCell(row[22], "GERAL");
                    const deptResolvedId = deptCell.numericId || resolveIdByDescription(row[18], deptIdByDescription, deptDescEntries);
                    const catResolvedId = catCell.numericId || resolveIdByDescription(row[22], catIdByDescription, catDescEntries);

                    const scope: ProductScope = {
                        groupId,
                        groupName,
                        deptId: deptResolvedId,
                        deptName: deptCell.name,
                        catId: catResolvedId,
                        catName: catCell.name
                    };

                    addScope(productsByReduced, reducedFromCadastro, scope);
                    addScope(productsByName, productNameKey, scope);
                });
            });

            const stockAcc: Record<string, { q: number; costAmount: number; name: string; groupId: string }> = {};
            const groupsMap: Record<string, Group> = {};
            rowsStock.forEach((row) => {
                if (!row) return;
                const reduced = normalizeBarcode(row[1]); // B
                if (!reduced) return;
                const productName = row[2]?.toString() || row[4]?.toString() || "Sem Descrição";
                const stockQty = parseStockNumber(row[14]); // O
                const stockCost = parseStockNumber(row[15]); // P
                const stockGroupNum = parseSheetNumericCode(row[6]); // G
                const stockGroupId = stockGroupNum !== null ? String(stockGroupNum) : '';
                if (stockQty <= 0) return;

                const prev = stockAcc[reduced] || { q: 0, costAmount: 0, name: productName, groupId: stockGroupId };
                stockAcc[reduced] = {
                    q: prev.q + stockQty,
                    costAmount: prev.costAmount + (stockQty * stockCost),
                    name: prev.name || productName,
                    groupId: prev.groupId || stockGroupId
                };
            });

            Object.entries(stockAcc).forEach(([reduced, acc]) => {
                const avgCost = acc.q > 0 ? (acc.costAmount / acc.q) : 0;
                const nameKey = cleanDescription(acc.name || "");
                const scopesByReduced = productsByReduced[reduced] || [];
                const scopesByName = nameKey ? (productsByName[nameKey] || []) : [];
                const scopes = scopesByReduced.length > 0 ? scopesByReduced : scopesByName;

                let chosenScope: ProductScope | null = null;
                if (scopes.length > 0) {
                    chosenScope = scopes.find(s => String(s.groupId) === String(acc.groupId)) || scopes[0];
                } else {
                    const catFallback = catReportByReduced[reduced];
                    if (catFallback && acc.groupId && ALLOWED_IDS.includes(Number(acc.groupId))) {
                        const deptFallback = parseHierarchyCell(catFallback.deptName, "OUTROS");
                        chosenScope = {
                            groupId: acc.groupId,
                            groupName: GROUP_CONFIG_DEFAULTS[acc.groupId] || `Grupo ${acc.groupId}`,
                            deptId: deptFallback.numericId,
                            deptName: deptFallback.name || "OUTROS",
                            catId: catFallback.catId || "",
                            catName: catFallback.catName || "GERAL"
                        };
                    }
                }
                if (!chosenScope) return;
                const resolvedScope: ProductScope = { ...chosenScope };
                const deptByReduced = deptReportByReduced[reduced];
                const catByReduced = catReportByReduced[reduced];
                if (deptByReduced) {
                    if (!resolvedScope.deptId && deptByReduced.deptId) {
                        resolvedScope.deptId = deptByReduced.deptId;
                    }
                    if ((!resolvedScope.deptName || resolvedScope.deptName === 'OUTROS') && deptByReduced.deptName) {
                        resolvedScope.deptName = deptByReduced.deptName;
                    }
                }
                if (catByReduced) {
                    if (!resolvedScope.catId && catByReduced.catId) {
                        resolvedScope.catId = catByReduced.catId;
                    }
                    if ((!resolvedScope.catName || resolvedScope.catName === 'GERAL') && catByReduced.catName) {
                        resolvedScope.catName = catByReduced.catName;
                    }
                    if (catByReduced.deptName) {
                        if (!resolvedScope.deptId) {
                            resolvedScope.deptId = resolveIdByDescription(catByReduced.deptName, deptIdByDescription, deptDescEntries);
                        }
                        if ((!resolvedScope.deptName || resolvedScope.deptName === 'OUTROS')) {
                            const deptParsed = parseHierarchyCell(catByReduced.deptName, "OUTROS");
                            resolvedScope.deptName = deptParsed.name || resolvedScope.deptName;
                            if (!resolvedScope.deptId && deptParsed.numericId) {
                                resolvedScope.deptId = deptParsed.numericId;
                            }
                        }
                    }
                }

                const finalGroupId = resolvedScope.groupId;
                const finalGroupName = resolvedScope.groupName;
                if (!groupsMap[finalGroupId]) groupsMap[finalGroupId] = { id: finalGroupId, name: finalGroupName, departments: [] };

                const deptIdentity = resolvedScope.deptId || resolvedScope.deptName;
                let dept = groupsMap[finalGroupId].departments.find(d => d.id === deptIdentity || d.name === resolvedScope.deptName);
                if (!dept) {
                    dept = {
                        id: deptIdentity,
                        numericId: resolvedScope.deptId || undefined,
                        name: resolvedScope.deptName,
                        categories: []
                    };
                    groupsMap[finalGroupId].departments.push(dept);
                } else if (!dept.numericId && resolvedScope.deptId) {
                    dept.numericId = resolvedScope.deptId;
                }

                const catIdentity = resolvedScope.catId || resolvedScope.catName;
                const catNodeId = `${finalGroupId}-${deptIdentity}-${catIdentity}`;
                let cat = dept.categories.find(c => c.id === catNodeId || c.name === resolvedScope.catName);
                if (!cat) {
                    cat = {
                        id: catNodeId,
                        numericId: resolvedScope.catId || undefined,
                        name: resolvedScope.catName,
                        itemsCount: 0,
                        totalQuantity: 0,
                        totalCost: 0,
                        status: AuditStatus.TODO,
                        products: []
                    };
                    dept.categories.push(cat);
                } else if (!cat.numericId && resolvedScope.catId) {
                    cat.numericId = resolvedScope.catId;
                }

                cat.itemsCount++;
                cat.totalQuantity += acc.q;
                cat.totalCost += (acc.q * avgCost);
                cat.products.push({
                    code: reduced,
                    reducedCode: reduced,
                    name: acc.name,
                    quantity: acc.q,
                    cost: avgCost
                });
            });

            const nextData: AuditData = {
                groups: Object.values(groupsMap).sort((a, b) => parseInt(a.id.split('+')[0]) - parseInt(b.id.split('+')[0])),
                empresa: selectedEmpresa,
                filial: selectedFilial,
                inventoryNumber: inventoryNumber.trim()
            };
            const finalData = (shouldReclassifyOpen && data) ? mergePreservingDone(data, nextData) : nextData;
            const finalTermDrafts = (shouldReclassifyOpen && data)
                ? (((data as any).termDrafts || termDrafts || {}) as Record<string, any>)
                : {};
            const basePersistedData = {
                ...finalData,
                termDrafts: finalTermDrafts,
                sourceFiles: buildStructureSourceMeta()
            } as any;
            const persistedData = applyPartialScopes(
                basePersistedData,
                shouldReclassifyOpen ? safePartialStarts : []
            );
            const progress = calculateProgress(finalData);
            const savedSession = await persistAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: persistedData,
                progress: progress,
                user_email: userEmail
            }, { allowProgressRegression: !!shouldReclassifyOpen });
            if (!savedSession) {
                throw new Error("Falha ao salvar auditoria inicial no Supabase.");
            }

            setDbSessionId(savedSession.id);
            setNextAuditNumber(savedSession.audit_number);
            setTermDrafts(finalTermDrafts as any);
            setData((savedSession.data as AuditData) || finalData);
            setGroupFiles(createInitialGroupFiles());
            setFileDeptIds(null);
            setFileCatIds(null);
            setFileStock(null);
            setIsUpdatingStock(false);
            setView({ level: 'groups' });
        } catch (err) {
            const detail = err instanceof Error
                ? err.message
                : (typeof err === 'string' ? err : 'Falha desconhecida');
            alert(`Erro ao processar/salvar arquivos da auditoria.\n\nDetalhe: ${detail}`);
            console.error('Erro detalhado em handleStartAudit:', {
                detail,
                selectedFilial,
                nextAuditNumber,
                hasOpenStructure: !!(data && data.groups && data.groups.length > 0),
                hasStructureFiles: effectiveGroupFiles.length > 0
            }, err);
        }
        finally { setIsProcessing(false); }
    };

    const handleLoadFromTrier = async () => {
        if (!selectedFilial) {
            alert("Selecione a filial antes de carregar do Trier.");
            return;
        }
        if (!inventoryNumber.trim()) {
            alert("Informe o número do inventário.");
            return;
        }
        setIsTrierLoading(true);
        setTrierError(null);
        try {
            const params = new URLSearchParams({
                filial: selectedFilial,
                empresa: selectedEmpresa
            });
            const response = await fetch(`${TRIER_API_BASE}/audit/bootstrap?${params.toString()}`);
            if (!response.ok) {
                let detail = "";
                try {
                    const body = await response.json();
                    detail = body?.detail || body?.message || "";
                } catch {
                    detail = "";
                }
                throw new Error(buildTrierErrorMessage(response.status, detail));
            }
            const payload = await response.json();
            if (!payload || !payload.groups) {
                throw new Error("Resposta invalida do servidor Trier.");
            }
            const preservedTermDrafts = ((data as any)?.termDrafts || termDrafts || {}) as Record<string, any>;
            const nextData = {
                ...payload,
                inventoryNumber: inventoryNumber.trim() || payload.inventoryNumber || "",
                termDrafts: preservedTermDrafts
            };
            const progress = calculateProgress(nextData as AuditData);
            const savedSession = await persistAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts: ((nextData as any)?.termDrafts || (data as any)?.termDrafts || termDrafts || {}) } as any,
                progress: progress,
                user_email: userEmail
            });
            if (!savedSession) {
                throw new Error("Falha ao salvar dados iniciais do Trier no Supabase.");
            }

            setDbSessionId(savedSession.id);
            setNextAuditNumber(savedSession.audit_number);
            setTermDrafts(preservedTermDrafts as any);
            setData((savedSession.data as AuditData) || (nextData as AuditData));
            setView({ level: 'groups' });
            setInitialDoneUnits(0);
            setSessionStartTime(Date.now());
            setGroupFiles(createInitialGroupFiles());
            setFileStock(null);
            setFileDeptIds(null);
            setFileCatIds(null);
        } catch (err: any) {
            setTrierError(mapFetchError(err));
        } finally {
            setIsTrierLoading(false);
        }
    };

    const buildTrierErrorMessage = (status: number, detail?: string) => {
        if (status === 401 || status === 498) return "Token invalido ou expirado.";
        if (status === 404) return "Endpoint do backend nao encontrado.";
        if (status === 502) {
            if (detail?.includes("ConnectTimeout")) return "Timeout ao conectar no Trier.";
            return "SGF offline ou nao acessivel no momento.";
        }
        if (detail) return `Erro Trier (${status}): ${detail}`;
        return `Erro Trier (${status}).`;
    };

    const mapFetchError = (err: any) => {
        const message = String(err?.message || err || "");
        if (
            message.includes("Failed to fetch") ||
            message.includes("NetworkError") ||
            message.includes("ERR_CONNECTION_REFUSED")
        ) {
            return `Backend offline ou bloqueado (${TRIER_API_BASE}).`;
        }
        return message || "Falha ao carregar dados do Trier.";
    };

    const branchMetrics = useMemo(() => {
        if (!data) return { skus: 0, units: 0, cost: 0, doneSkus: 0, doneUnits: 0, doneCost: 0, progress: 0, pendingUnits: 0, pendingSkus: 0, pendingCost: 0, totalCategories: 0, doneCategories: 0 };
        let skus = 0, units = 0, cost = 0, doneSkus = 0, doneUnits = 0, doneCost = 0, totalCats = 0, doneCats = 0;
        data.groups.forEach(g => g.departments.forEach(d => d.categories.forEach(c => {
            skus += c.itemsCount;
            units += c.totalQuantity;
            cost += (c.totalCost || 0);
            totalCats++;
            if (isDoneStatus(c.status)) {
                doneSkus += c.itemsCount;
                doneUnits += c.totalQuantity;
                doneCost += (c.totalCost || 0);
                doneCats++;
            }
        })));
        return {
            skus, units, cost, doneSkus, doneUnits, doneCost,
            pendingUnits: units - doneUnits,
            pendingSkus: skus - doneSkus,
            pendingCost: cost - doneCost,
            totalCategories: totalCats,
            doneCategories: doneCats,
            progress: skus > 0 ? (doneSkus / skus) * 100 : 0,
            progressUnits: units > 0 ? (doneUnits / units) * 100 : 0,
            progressCost: cost > 0 ? (doneCost / cost) * 100 : 0
        };
    }, [data]);

    const productivity = useMemo(() => {
        if (!data) return { speed: 0, etaDays: 0, countedThisSession: 0 };
        const countedThisSession = Math.max(0, branchMetrics.doneUnits - initialDoneUnits);
        const elapsedHours = (Date.now() - sessionStartTime) / (1000 * 60 * 60);
        const speed = countedThisSession / Math.max(0.05, elapsedHours);
        const remainingHours = branchMetrics.pendingUnits / Math.max(1, speed);
        const etaDays = remainingHours / 8;
        return { speed, etaDays: isFinite(etaDays) ? etaDays : 0, countedThisSession };
    }, [data, branchMetrics.doneUnits, branchMetrics.pendingUnits, sessionStartTime, initialDoneUnits]);

    const calcScopeMetrics = (scope: Group | Department) => {
        let skus = 0, units = 0, cost = 0, doneSkus = 0, doneUnits = 0, doneCost = 0;
        const cats = 'departments' in scope ? scope.departments.flatMap(d => d.categories) : scope.categories;
        cats.forEach(c => {
            skus += c.itemsCount;
            units += c.totalQuantity;
            cost += (c.totalCost || 0);
            if (isDoneStatus(c.status)) {
                doneSkus += c.itemsCount;
                doneUnits += c.totalQuantity;
                doneCost += (c.totalCost || 0);
            }
        });
        return {
            skus, units, cost, doneSkus, doneUnits, doneCost,
            pendingUnits: units - doneUnits,
            pendingSkus: skus - doneSkus,
            pendingCost: cost - doneCost,
            progress: skus > 0 ? (doneSkus / skus) * 100 : 0,
            progressUnits: units > 0 ? (doneUnits / units) * 100 : 0,
            progressCost: cost > 0 ? (doneCost / cost) * 100 : 0
        };
    };

    const getDeptById = (group: Group, deptId?: string) => group.departments.find(d => d.id === deptId);

    const getScopeCategories = (groupId?: string | number, deptId?: string | number, catId?: string | number) => {
        if (!data) return [] as { group: Group; dept: Department; cat: Category }[];
        const g = data.groups.find(gr => normalizeScopeId(gr.id) === normalizeScopeId(groupId));
        if (!g) return [];
        if (catId) {
            const targetDept = deptId
                ? g.departments.find(d => normalizeScopeId(d.id) === normalizeScopeId(deptId))
                : g.departments.find(d => d.categories.some(c => normalizeScopeId(c.id) === normalizeScopeId(catId)));
            const cat = targetDept?.categories.find(c => normalizeScopeId(c.id) === normalizeScopeId(catId));
            return targetDept && cat ? [{ group: g, dept: targetDept, cat }] : [];
        }
        if (deptId) {
            const dept = g.departments.find(d => normalizeScopeId(d.id) === normalizeScopeId(deptId));
            if (!dept) return [];
            return dept.categories.map(c => ({ group: g, dept, cat: c }));
        }
        return g.departments.flatMap(d => d.categories.map(c => ({ group: g, dept: d, cat: c })));
    };

    const getPartialPercentForGroup = (group: Group, totalSkus: number) => {
        if (!data?.partialStarts || data.partialStarts.length === 0 || totalSkus <= 0) return 0;
        const catMap = new Map<string, number>();
        group.departments.forEach(d => d.categories.forEach(c => catMap.set(c.id, c.itemsCount)));
        const selected = new Set<string>();
        data.partialStarts.forEach(p => {
            if (normalizeScopeId(p.groupId) !== normalizeScopeId(group.id)) return;
            if (!p.deptId) {
                group.departments.forEach(d => d.categories.forEach(c => selected.add(c.id)));
                return;
            }
            const dept = getDeptById(group, normalizeScopeId(p.deptId));
            if (!dept) return;
            if (!p.catId) {
                dept.categories.forEach(c => selected.add(c.id));
                return;
            }
            const cat = dept.categories.find(c => normalizeScopeId(c.id) === normalizeScopeId(p.catId));
            if (cat) selected.add(cat.id);
        });
        let sum = 0;
        selected.forEach(id => { sum += catMap.get(id) || 0; });
        return totalSkus > 0 ? (sum / totalSkus) * 100 : 0;
    };

    const getPartialPercentForDept = (group: Group, dept: Department, totalSkus: number) => {
        if (!data?.partialStarts || data.partialStarts.length === 0 || totalSkus <= 0) return 0;
        const catMap = new Map<string, number>();
        dept.categories.forEach(c => catMap.set(c.id, c.itemsCount));
        const selected = new Set<string>();
        data.partialStarts.forEach(p => {
            if (normalizeScopeId(p.groupId) !== normalizeScopeId(group.id)) return;
            if (!p.deptId) {
                dept.categories.forEach(c => selected.add(c.id));
                return;
            }
            if (normalizeScopeId(p.deptId) !== normalizeScopeId(dept.id)) return;
            if (!p.catId) {
                dept.categories.forEach(c => selected.add(c.id));
                return;
            }
            const cat = dept.categories.find(c => normalizeScopeId(c.id) === normalizeScopeId(p.catId));
            if (cat) selected.add(cat.id);
        });
        let sum = 0;
        selected.forEach(id => { sum += catMap.get(id) || 0; });
        return totalSkus > 0 ? (sum / totalSkus) * 100 : 0;
    };

    const buildTermKey = (scope: TermScope) => {
        if (scope.type === 'custom') {
            const customKey = (scope.customScopes || [])
                .map(s => partialScopeKey(s))
                .filter(Boolean)
                .sort()
                .join(',');
            return `custom|${scope.batchId || ''}|${customKey}`;
        }
        return [scope.type, scope.groupId || '', scope.deptId || '', scope.catId || ''].join('|');
    };

    const getLegacyCustomTermKey = (scope: TermScope) => {
        if (scope.type !== 'custom') return '';
        const customKey = (scope.customScopes || [])
            .map(s => partialScopeKey(s))
            .filter(Boolean)
            .sort()
            .join(',');
        return customKey ? `custom|${customKey}` : '';
    };

    const upsertScopeDraft = (
        sourceDrafts: Record<string, TermForm>,
        scope: TermScope,
        draft: TermForm
    ) => {
        const key = buildTermKey(scope);
        const nextDrafts = { ...(sourceDrafts || {}), [key]: draft };
        const legacyKey = getLegacyCustomTermKey(scope);
        if (legacyKey && legacyKey !== key) {
            delete nextDrafts[legacyKey];
        }
        return nextDrafts;
    };

    const getScopedMetrics = useCallback((scope: { type: 'group' | 'department' | 'category', groupId: string, deptId?: string, catId?: string }) => {
        const tk = buildTermKey(scope as any);
        const directDraft = termDrafts[tk];
        if (directDraft?.excelMetricsRemovedAt && !directDraft?.excelMetrics) return null;
        const draftMetrics = directDraft?.excelMetrics;
        const makeScopeCatKeys = (s: { groupId?: string; deptId?: string; catId?: string }) =>
            new Set(
                getScopeCategories(s.groupId, s.deptId, s.catId)
                    .map(({ group, dept, cat }) => partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id }))
            );
        const targetCatKeys = makeScopeCatKeys(scope as any);
        const parseCustomDraftKey = (draftKey: string) => {
            const match = draftKey.match(/^custom\|([^|]*)(?:\|(.*))?$/);
            if (!match) return null as null | { batchId?: string; scopesPart: string };
            const hasNewFormat = typeof match[2] === 'string';
            if (hasNewFormat) return { batchId: (match[1] || '').trim() || undefined, scopesPart: match[2] || '' };
            return { batchId: undefined, scopesPart: match[1] || '' }; // legado
        };
        const draftTouchesScope = (draftKey: string) => {
            if (targetCatKeys.size === 0) return false;
            if (draftKey.startsWith('custom|')) {
                const meta = parseCustomDraftKey(draftKey);
                const scopedKeys = (meta?.scopesPart || '').split(',').filter(Boolean);
                for (const scopeKey of scopedKeys) {
                    const [g, d, c] = scopeKey.split('|');
                    const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
                    for (const { group, dept, cat } of expanded) {
                        if (targetCatKeys.has(partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id }))) return true;
                    }
                }
                return false;
            }
            const [type, g, d, c] = draftKey.split('|');
            if (!type || type === 'custom') return false;
            const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
            for (const { group, dept, cat } of expanded) {
                if (targetCatKeys.has(partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id }))) return true;
            }
            return false;
        };
        const scopedEntries = Object.entries(termDrafts || {})
            .filter(([draftKey, draft]) => {
                if (!draft?.excelMetrics || draft?.excelMetricsRemovedAt) return false;
                if (!draftTouchesScope(draftKey)) return false;
                return true;
            })
            .map(([draftKey, draft]) => ({ draftKey, draft: draft! }));
        const scopedPools = scopedEntries
            .map(({ draft }) => draft.excelMetrics)
            .filter(Boolean);
        // Prioridade: Rascunho do próprio termo > Soma dos termos do mesmo grupo
        const base = draftMetrics || mergeExcelMetricsPools(scopedPools as any[]);

        if (!base || !base.groupedDifferences) return null;

        const group = data?.groups?.find(g => normalizeScopeId(g.id) === normalizeScopeId(scope.groupId));
        if (!group) return null;

        const gName = normalizeText(group.name);
        let dName = '';
        let cName = '';

        if (scope.deptId) {
            const dept = group.departments.find(d => normalizeScopeId(d.id) === normalizeScopeId(scope.deptId!));
            if (dept) dName = normalizeText(dept.name);
        }
        if (scope.catId && scope.deptId) {
            const dept = group.departments.find(d => normalizeScopeId(d.id) === normalizeScopeId(scope.deptId!));
            const cat = dept?.categories.find(c => normalizeScopeId(c.id) === normalizeScopeId(scope.catId!));
            if (cat) cName = normalizeText(cat.name);
        }

        const filtered = base.groupedDifferences.filter((d: any) => {
            const matchG = normalizeText(d.groupName) === gName;
            if (scope.type === 'group') return matchG;
            const matchD = normalizeText(d.deptName) === dName;
            if (scope.type === 'department') return matchG && matchD;
            const matchC = normalizeText(d.catName) === cName;
            return matchG && matchD && matchC;
        });

        if (filtered.length === 0) return null;

        return filtered.reduce((acc: any, curr: any) => ({
            sysQty: (acc.sysQty || 0) + (curr.sysQty || 0),
            sysCost: (acc.sysCost || 0) + (curr.sysCost || 0),
            countedQty: (acc.countedQty || 0) + (curr.countedQty || 0),
            countedCost: (acc.countedCost || 0) + (curr.countedCost || 0),
            diffQty: (acc.diffQty || 0) + (curr.diffQty || 0),
            diffCost: (acc.diffCost || 0) + (curr.diffCost || 0)
        }), { sysQty: 0, sysCost: 0, countedQty: 0, countedCost: 0, diffQty: 0, diffCost: 0 });
    }, [data, termDrafts, buildTermKey, getScopeCategories]);

    const createDefaultTermForm = (): TermForm => ({
        inventoryNumber: inventoryNumber || data?.inventoryNumber || '',
        date: new Date().toLocaleDateString('pt-BR'),
        managerName2: '',
        managerCpf2: '',
        managerSignature2: '',
        managerName: '',
        managerCpf: '',
        managerSignature: '',
        collaborators: Array.from({ length: 10 }, () => ({ name: '', cpf: '', signature: '' }))
    });

    const openTermModal = (scope: TermScope) => {
        const key = buildTermKey(scope);
        let draft = termDrafts[key];
        const legacyKey = getLegacyCustomTermKey(scope);
        if (!draft && scope.type === 'custom' && scope.batchId && legacyKey) draft = termDrafts[legacyKey];
        const nextForm = draft
            ? (!draft.inventoryNumber && (inventoryNumber || data?.inventoryNumber)
                ? { ...draft, inventoryNumber: inventoryNumber || data?.inventoryNumber || '' }
                : draft)
            : createDefaultTermForm();
        setTermModal(scope);
        setTermForm(nextForm);

        const scopeGroupIds = getScopeGroupIds(scope);
        const fallbackPools = scope.type === 'custom'
            ? (scope.batchId
                ? scopeGroupIds.flatMap(groupId => getExcelPoolsByGroupFromDrafts(termDrafts, groupId, { batchId: scope.batchId }))
                : [])
            : (() => {
                const targetCatKeys = new Set(
                    getScopeCategories(scope.groupId, scope.deptId, scope.catId)
                        .map(({ group, dept, cat }) => partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id }))
                );
                const parseCustomDraftKey = (draftKey: string) => {
                    const match = draftKey.match(/^custom\|([^|]*)(?:\|(.*))?$/);
                    if (!match) return null as null | { batchId?: string; scopesPart: string };
                    const hasNewFormat = typeof match[2] === 'string';
                    if (hasNewFormat) return { batchId: (match[1] || '').trim() || undefined, scopesPart: match[2] || '' };
                    return { batchId: undefined, scopesPart: match[1] || '' };
                };
                const draftTouchesScope = (draftKey: string) => {
                    if (targetCatKeys.size === 0) return false;
                    if (draftKey.startsWith('custom|')) {
                        const meta = parseCustomDraftKey(draftKey);
                        const scopedKeys = (meta?.scopesPart || '').split(',').filter(Boolean);
                        for (const scopeKey of scopedKeys) {
                            const [g, d, c] = scopeKey.split('|');
                            const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
                            for (const { group, dept, cat } of expanded) {
                                if (targetCatKeys.has(partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id }))) return true;
                            }
                        }
                        return false;
                    }
                    const [type, g, d, c] = draftKey.split('|');
                    if (!type || type === 'custom') return false;
                    const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
                    for (const { group, dept, cat } of expanded) {
                        if (targetCatKeys.has(partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id }))) return true;
                    }
                    return false;
                };
                const scopedEntries = Object.entries(termDrafts || {})
                    .filter(([draftKey, draft]) => {
                        if (!draft?.excelMetrics || draft?.excelMetricsRemovedAt) return false;
                        if (!draftTouchesScope(draftKey)) return false;
                        return true;
                    })
                    .map(([draftKey, draft]) => ({ draftKey, draft: draft! }));
                return scopedEntries
                    .map(({ draft }) => draft.excelMetrics)
                    .filter(Boolean);
            })();
        // Termos dependentes devem refletir o termo origem do mesmo escopo/grupo:
        // prioriza excel do próprio termo; sem ele, agrega os termos compatíveis da filial.
        const hasExplicitRemoval = !!(draft?.excelMetricsRemovedAt && !draft?.excelMetrics);
        const rawPool = hasExplicitRemoval
            ? null
            : (draft?.excelMetrics || mergeExcelMetricsPools(fallbackPools as any[]));

        let nextMetrics = null;

        if (rawPool?.groupedDifferences && scope.type === 'custom') {
            if (scopeGroupIds.length > 0 && data?.groups) {
                const acceptedNames = new Set<string>();
                scopeGroupIds.forEach(id => {
                    const group = data.groups.find(g => normalizeScopeId(g.id) === normalizeScopeId(id));
                    if (group) acceptedNames.add(normalizeText(group.name));
                    acceptedNames.add(normalizeText(GROUP_CONFIG_DEFAULTS[id as keyof typeof GROUP_CONFIG_DEFAULTS] || `Grupo ${id}`));
                });

                const filteredGrouped = (rawPool.groupedDifferences || []).filter((d: any) =>
                    acceptedNames.has(normalizeText(d.groupName))
                );
                const filteredItems = (rawPool.items || []).filter((it: any) =>
                    acceptedNames.has(normalizeText(it.groupName))
                );

                if (filteredGrouped.length > 0 || filteredItems.length > 0) {
                    const groupedSource = filteredGrouped.length > 0
                        ? filteredGrouped
                        : (filteredItems || []).map((it: any) => ({
                            groupName: it.groupName,
                            deptName: it.deptName,
                            catName: it.catName,
                            sysQty: it.sysQty || 0,
                            sysCost: it.sysCost || 0,
                            countedQty: it.countedQty || 0,
                            countedCost: it.countedCost || 0,
                            diffQty: it.diffQty || 0,
                            diffCost: it.diffCost || 0
                        }));

                    const aggregated = groupedSource.reduce((acc: any, curr: any) => ({
                        sysQty: (acc.sysQty || 0) + (curr.sysQty || 0),
                        sysCost: (acc.sysCost || 0) + (curr.sysCost || 0),
                        countedQty: (acc.countedQty || 0) + (curr.countedQty || 0),
                        countedCost: (acc.countedCost || 0) + (curr.countedCost || 0),
                        diffQty: (acc.diffQty || 0) + (curr.diffQty || 0),
                        diffCost: (acc.diffCost || 0) + (curr.diffCost || 0)
                    }), { sysQty: 0, sysCost: 0, countedQty: 0, countedCost: 0, diffQty: 0, diffCost: 0 });

                    nextMetrics = {
                        ...aggregated,
                        items: filteredItems,
                        groupedDifferences: filteredGrouped
                    };
                }
            }

            if (!nextMetrics) {
                nextMetrics = rawPool;
            }
        }

        if (rawPool?.groupedDifferences && scope.groupId) {
            const group = data?.groups?.find(g => normalizeScopeId(g.id) === normalizeScopeId(scope.groupId));
            if (group) {
                const gName = normalizeText(group.name);
                let dName = '';
                let cName = '';

                if (scope.deptId) {
                    const dept = group.departments.find(d => normalizeScopeId(d.id) === normalizeScopeId(scope.deptId!));
                    if (dept) dName = normalizeText(dept.name);
                }
                if (scope.catId && scope.deptId) {
                    const dept = group.departments.find(d => normalizeScopeId(d.id) === normalizeScopeId(scope.deptId!));
                    const cat = dept?.categories.find(c => normalizeScopeId(c.id) === normalizeScopeId(scope.catId!));
                    if (cat) cName = normalizeText(cat.name);
                }

                const filteredGrouped = rawPool.groupedDifferences.filter((d: any) => {
                    const matchG = normalizeText(d.groupName) === gName;
                    if (scope.type === 'group') return matchG;
                    const matchD = normalizeText(d.deptName) === dName;
                    if (scope.type === 'department') return matchG && matchD;
                    const matchC = normalizeText(d.catName) === cName;
                    return matchG && matchD && matchC;
                });

                const filteredItems = (rawPool.items || []).filter((it: any) => {
                    const matchG = normalizeText(it.groupName) === gName;
                    if (scope.type === 'group') return matchG;
                    const matchD = normalizeText(it.deptName) === dName;
                    if (scope.type === 'department') return matchG && matchD;
                    const matchC = normalizeText(it.catName) === cName;
                    return matchG && matchD && matchC;
                });

                if (filteredGrouped.length > 0 || filteredItems.length > 0) {
                    const groupedSource = filteredGrouped.length > 0
                        ? filteredGrouped
                        : (filteredItems || []).reduce((acc: any[], it: any) => {
                            const key = `${it.groupName}|${it.deptName}|${it.catName}`;
                            const existing = acc.find(x => `${x.groupName}|${x.deptName}|${x.catName}` === key);
                            if (existing) {
                                existing.sysQty += it.sysQty || 0;
                                existing.sysCost += it.sysCost || 0;
                                existing.countedQty += it.countedQty || 0;
                                existing.countedCost += it.countedCost || 0;
                                existing.diffQty += it.diffQty || 0;
                                existing.diffCost += it.diffCost || 0;
                            } else {
                                acc.push({
                                    groupName: it.groupName,
                                    deptName: it.deptName,
                                    catName: it.catName,
                                    sysQty: it.sysQty || 0,
                                    sysCost: it.sysCost || 0,
                                    countedQty: it.countedQty || 0,
                                    countedCost: it.countedCost || 0,
                                    diffQty: it.diffQty || 0,
                                    diffCost: it.diffCost || 0
                                });
                            }
                            return acc;
                        }, []);

                    const aggregated = groupedSource.reduce((acc: any, curr: any) => ({
                        sysQty: (acc.sysQty || 0) + (curr.sysQty || 0),
                        sysCost: (acc.sysCost || 0) + (curr.sysCost || 0),
                        countedQty: (acc.countedQty || 0) + (curr.countedQty || 0),
                        countedCost: (acc.countedCost || 0) + (curr.countedCost || 0),
                        diffQty: (acc.diffQty || 0) + (curr.diffQty || 0),
                        diffCost: (acc.diffCost || 0) + (curr.diffCost || 0)
                    }), { sysQty: 0, sysCost: 0, countedQty: 0, countedCost: 0, diffQty: 0, diffCost: 0 });

                    nextMetrics = {
                        ...aggregated,
                        items: filteredItems,
                        groupedDifferences: groupedSource
                    };
                }
            }
        }

        // Corrigir apenas groupName e tentar upgrade de DIVERSOS via data.groups
        // NÃO re-classifica itens que já têm dept/cat válidos — apenas corrige o grupo
        if (nextMetrics && scope.groupId) {
            const termGroupName = GROUP_CONFIG_DEFAULTS[scope.groupId] || `Grupo ${scope.groupId}`;

            // Build localLookup only to TRY to upgrade DIVERSOS items that might now be in data.groups
            const localLookup = new Map<string, { deptName: string; catName: string }>();
            if (data?.groups) {
                const groupObj = data.groups.find(g => String(g.id) === String(scope.groupId));
                if (groupObj) {
                    groupObj.departments.forEach(d => {
                        d.categories.forEach(c => {
                            c.products.forEach(p => {
                                const key = normalizeBarcode(p.reducedCode || p.code);
                                if (key) localLookup.set(key, { deptName: d.name, catName: c.name });
                                const altKey = normalizeBarcode(p.code);
                                if (altKey && altKey !== key && !localLookup.has(altKey)) {
                                    localLookup.set(altKey, { deptName: d.name, catName: c.name });
                                }
                            });
                        });
                    });
                }
            }

            // Fix items: correct groupName, and ONLY upgrade from DIVERSOS if localLookup has a match
            if (nextMetrics.items) {
                nextMetrics.items = nextMetrics.items.map((item: any) => {
                    // Always fix groupName to match current term scope
                    const fixedGroupName = termGroupName;

                    const alreadyClassified =
                        item.deptName && item.deptName !== 'DIVERSOS (SEM DEPARTAMENTO)' &&
                        item.catName && item.catName !== 'DIVERSOS (SEM CATEGORIA)';

                    if (alreadyClassified) {
                        // Keep existing dept/cat — they were correctly classified by the upload
                        return { ...item, groupName: fixedGroupName };
                    }

                    // Item is still in DIVERSOS — try to upgrade via localLookup
                    const match = localLookup.get(normalizeBarcode(item.code));
                    return {
                        ...item,
                        groupName: fixedGroupName,
                        deptName: match ? match.deptName : 'DIVERSOS (SEM DEPARTAMENTO)',
                        catName: match ? match.catName : 'DIVERSOS (SEM CATEGORIA)'
                    };
                });
            }

            // Re-aggregate groupedDifferences from corrected items
            if (nextMetrics.items) {
                const gMap: Record<string, { groupName: string; deptName: string; catName: string; sysQty: number; sysCost: number; countedQty: number; countedCost: number; diffCost: number; diffQty: number }> = {};
                nextMetrics.items.forEach((item: any) => {
                    const key = `${item.groupName}|${item.deptName}|${item.catName}`;
                    if (!gMap[key]) {
                        gMap[key] = {
                            groupName: item.groupName,
                            deptName: item.deptName,
                            catName: item.catName,
                            sysQty: 0,
                            sysCost: 0,
                            countedQty: 0,
                            countedCost: 0,
                            diffCost: 0,
                            diffQty: 0
                        };
                    }
                    gMap[key].sysQty += (item.sysQty || 0);
                    gMap[key].sysCost += (item.sysCost || 0);
                    gMap[key].countedQty += (item.countedQty || 0);
                    gMap[key].countedCost += (item.countedCost || 0);
                    gMap[key].diffCost += (item.diffCost || 0);
                    gMap[key].diffQty += (item.diffQty || 0);
                });
                nextMetrics.groupedDifferences = Object.values(gMap).sort((a, b) => a.diffCost - b.diffCost);
            }
        }
        setTermComparisonMetrics(nextMetrics);

        // Persist re-classified metrics & form to termDrafts always (not conditional on reference equality)
        const formToSave = nextMetrics
            ? { ...nextForm, excelMetrics: nextMetrics }
            : nextForm;
        setTermDrafts(current => upsertScopeDraft(current, scope as any, formToSave));
    };

    const updateTermForm = (updater: (prev: TermForm) => TermForm) => {
        setTermForm(prev => {
            if (!prev) return prev;
            const next = updater(prev);
            if (termModal) {
                const key = buildTermKey(termModal);
                setTermDrafts(current => {
                    const persistedMetrics =
                        termComparisonMetrics ||
                        next.excelMetrics ||
                        current[key]?.excelMetrics;
                    return upsertScopeDraft(
                        current,
                        termModal,
                        persistedMetrics ? { ...next, excelMetrics: persistedMetrics } : next
                    );
                });
            }
            return next;
        });
    };

    const closeTermModal = useCallback(() => {
        const currentScope = termModal;
        const currentForm = termForm;
        const currentData = data;
        const currentDrafts = termDrafts;
        const currentMetrics = termComparisonMetrics;

        // Fecha instantaneamente; persistência roda em background.
        setTermModal(null);
        setTermForm(null);
        setTermComparisonMetrics(null);

        if (isMaster && currentScope && currentForm && currentData) {
            const key = buildTermKey(currentScope);
            const forceCleared = removedExcelDraftKeysRef.current.has(key);
            const persistedMetrics =
                forceCleared
                    ? undefined
                    : (currentMetrics ||
                        currentForm.excelMetrics ||
                        currentDrafts[key]?.excelMetrics);
            const formToSave = persistedMetrics
                ? { ...currentForm, excelMetrics: persistedMetrics }
                : currentForm;
            const nextDrafts = upsertScopeDraft(currentDrafts, currentScope, formToSave);
            const nextDataWithTerms = { ...currentData, termDrafts: nextDrafts } as any;
            setTermDrafts(nextDrafts);
            setData(nextDataWithTerms as AuditData);
            void (async () => {
                try {
                    let skus = 0;
                    let doneSkus = 0;
                    (nextDataWithTerms.groups || []).forEach((g: any) =>
                        (g.departments || []).forEach((d: any) =>
                            (d.categories || []).forEach((c: any) => {
                                skus += Number(c.itemsCount || 0);
                                if (isDoneStatus(c.status)) doneSkus += Number(c.itemsCount || 0);
                            })
                        )
                    );
                    const progress = skus > 0 ? (doneSkus / skus) * 100 : 0;
                    const savedSession = await persistAuditSession({
                        id: dbSessionId,
                        branch: selectedFilial,
                        audit_number: nextAuditNumber,
                        status: 'open',
                        data: nextDataWithTerms,
                        progress: progress,
                        user_email: userEmail
                    });
                    if (savedSession) {
                        await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
                    }
                } catch (err) {
                    console.error("Error autosaving term draft on close:", err);
                }
            })();
            if (forceCleared) {
                removedExcelDraftKeysRef.current.delete(key);
            }
        }
    }, [termModal, termForm, termComparisonMetrics, isMaster, data, termDrafts, dbSessionId, selectedFilial, nextAuditNumber, userEmail]);

    const handleProcessTermComparisonExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) {
            setTermComparisonMetrics(null);
            return;
        }

        try {
            const rows = await readExcel(file);
            let sysQty = 0;
            let sysCost = 0;
            let countedQty = 0;
            let countedCost = 0;
            let diffQtySum = 0;
            let diffCostSum = 0;
            const items: any[] = [];
            const scopeGroupIds = getScopeGroupIds(termModal);
            const hasSingleScopeGroup = scopeGroupIds.length === 1;
            const primaryScopeGroupId = hasSingleScopeGroup ? scopeGroupIds[0] : undefined;
            const scopedGroupNameSet = new Set<string>();
            if (data?.groups && scopeGroupIds.length > 0) {
                data.groups.forEach(g => {
                    if (scopeGroupIds.includes(normalizeScopeId(g.id))) {
                        scopedGroupNameSet.add(normalizeText(g.name));
                    }
                });
            }
            const singleScopedGroupName = primaryScopeGroupId
                ? (GROUP_CONFIG_DEFAULTS[primaryScopeGroupId as keyof typeof GROUP_CONFIG_DEFAULTS] || `Grupo ${primaryScopeGroupId}`)
                : undefined;

            // --- Universal Registry: fallback scan of ALL group cadastro files ---
            const universalRegistry = new Map<string, { groupName: string, deptName: string, catName: string }>();

            const loadUniversalRegistry = async () => {
                const allGroupFiles = { ...globalGroupFiles, ...groupFiles };
                for (const groupId of GROUP_UPLOAD_IDS) {
                    const file = allGroupFiles[groupId];
                    if (!file) continue;

                    try {
                        const rows = await readExcel(file);
                        const groupName = GROUP_CONFIG_DEFAULTS[groupId] || `Grupo ${groupId}`;

                        rows.forEach((row: any[]) => {
                            if (!row || row.length < 4) return;

                            const deptRaw = String(row[18] ?? '').trim(); // Col S = departamento
                            const catRaw = String(row[22] ?? '').trim(); // Col W = categoria
                            if (!deptRaw && !catRaw) return;

                            const deptName = parseHierarchyCell(deptRaw, 'DIVERSOS (SEM DEPARTAMENTO)').name;
                            const catName = parseHierarchyCell(catRaw, 'DIVERSOS (SEM CATEGORIA)').name;

                            const codes = [normalizeBarcode(row[1]), normalizeBarcode(row[2])].filter(Boolean);
                            codes.forEach(code => {
                                if (code && !universalRegistry.has(code)) {
                                    universalRegistry.set(code, { groupName, deptName, catName });
                                }
                            });
                        });
                    } catch (err) { }
                }
            };

            await loadUniversalRegistry();

            // Pre-build hierarchy lookup for fast cross-referencing Col B (código reduzido)
            // Can contain multiple hierarchies if the item spans groups
            const productLookup = new Map<string, { groupName: string, deptName: string, catName: string }[]>();
            if (data?.groups) {
                data.groups.forEach(g => {
                    g.departments.forEach(d => {
                        d.categories.forEach(c => {
                            c.products.forEach(p => {
                                const key = normalizeBarcode(p.reducedCode || p.code);
                                if (key) {
                                    const ex = productLookup.get(key) || [];
                                    // Prevent strict duplicates
                                    if (!ex.find(e => e.groupName === g.name && e.deptName === d.name && e.catName === c.name)) {
                                        ex.push({ groupName: g.name, deptName: d.name, catName: c.name });
                                    }
                                    productLookup.set(key, ex);
                                }
                                const altKey = normalizeBarcode(p.code);
                                if (altKey && altKey !== key) {
                                    const ex = productLookup.get(altKey) || [];
                                    if (!ex.find(e => e.groupName === g.name && e.deptName === d.name && e.catName === c.name)) {
                                        ex.push({ groupName: g.name, deptName: d.name, catName: c.name });
                                    }
                                    productLookup.set(altKey, ex);
                                }
                            });
                        });
                    });
                });
            }

            // --- Secondary lookup: read cadastro file directly for this group ---
            // Pega itens com estoque zero (não em data.groups) via Col B e Col C (código reduzido)
            const cadastroLookup = new Map<string, { deptName: string; catName: string }>();
            if (primaryScopeGroupId) {
                const groupIdKey = primaryScopeGroupId as typeof GROUP_UPLOAD_IDS[number];
                const cadastroFile = groupFiles[groupIdKey] || globalGroupFiles[groupIdKey];
                if (cadastroFile) {
                    try {
                        const cadastroRows = await readExcel(cadastroFile);
                        cadastroRows.forEach((row: any[]) => {
                            if (!row || row.length < 4) return;

                            const deptRaw = String(row[18] ?? '').trim(); // Col S = departamento
                            const catRaw = String(row[22] ?? '').trim(); // Col W = categoria

                            // Skip rows where both dept and cat are empty (header/blank rows)
                            if (!deptRaw && !catRaw) return;

                            const deptName = parseHierarchyCell(deptRaw, 'DIVERSOS (SEM DEPARTAMENTO)').name;
                            const catName = parseHierarchyCell(catRaw, 'DIVERSOS (SEM CATEGORIA)').name;

                            // Index by BOTH Col B (row[1]) AND Col C (row[2]) — same reduced code in different files
                            const codeB = normalizeBarcode(row[1]); // Col B
                            const codeC = normalizeBarcode(row[2]); // Col C

                            if (codeB && !cadastroLookup.has(codeB)) {
                                cadastroLookup.set(codeB, { deptName, catName });
                            }
                            if (codeC && codeC !== codeB && !cadastroLookup.has(codeC)) {
                                cadastroLookup.set(codeC, { deptName, catName });
                            }
                        });

                    } catch (err) { }
                }
            }


            const groupedMap: Record<string, { groupName: string, deptName: string, catName: string, sysQty: number, sysCost: number, countedQty: number, countedCost: number, diffQty: number, diffCost: number }> = {};

            // Skip header (row 0), process data rows
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row) continue;

                // Se houver "Total Geral", ignorar
                const desc = String(row[1] || '').trim().toLowerCase();
                const colG = String(row[6] || '').trim().toLowerCase();
                if (desc.includes('total geral') || colG.includes('total geral')) {
                    continue;
                }

                // Índices informados:
                // C (2): Descrição
                // K (10): Estoque Sistema
                // M (12): Custo Sistema (Valores M)
                // N (13): Diferença (Qtd)
                // O (14): Estoque Físico
                // Q (16): Custo Físico (Valores Q - Diferença financeira seria Q - M)

                const sq = parseStockNumber(row[10]); // K
                const sc = parseStockNumber(row[12]); // M
                const cq = parseStockNumber(row[14]); // O
                const cc = parseStockNumber(row[16]); // Q

                // A diferença QTD agora é calculada matematicamente (Físico - Sistema) em vez de ler a coluna N, 
                // pois a soma literal de N estava gerando valores incorretos (+71.488 un).
                const dq = cq - sq;

                // Captura os dados básicos da linha para imprimir no termo depois
                const code = String(row[1] || '').trim(); // B: Cód Reduzido
                const description = String(row[2] || '').trim(); // C: Descrição
                const lab = String(row[3] || '').trim();

                sysQty += sq;
                sysCost += sc;
                countedQty += cq;
                countedCost += cc;
                diffQtySum += dq;
                const costDiff = cc - sc;
                diffCostSum += costDiff;

                // Identifica a Hierarquia cruzando com memory database
                const forcedGroupName = primaryScopeGroupId
                    ? (GROUP_CONFIG_DEFAULTS[primaryScopeGroupId as keyof typeof GROUP_CONFIG_DEFAULTS] || `Grupo ${primaryScopeGroupId}`)
                    : undefined;

                // Normaliza o código da coluna B para o mesmo formato do lookup
                let normalizedCode = normalizeBarcode(code);
                let registries = productLookup.get(normalizedCode) || [];
                let localCadastroEntry = cadastroLookup.get(normalizedCode);
                let universalEntry = universalRegistry.get(normalizedCode);

                // Multi-match agressivo: Se não achou pelas vias normais na coluna B, vasculha A até F
                if (registries.length === 0 && !localCadastroEntry && !universalEntry) {
                    for (let c = 0; c <= 5; c++) {
                        if (c === 1) continue; // já testou
                        const testCode = normalizeBarcode(row[c]);
                        if (testCode) {
                            if (productLookup.has(testCode)) {
                                normalizedCode = testCode;
                                registries = productLookup.get(testCode) || [];
                                break;
                            }
                            if (cadastroLookup.has(testCode)) {
                                normalizedCode = testCode;
                                localCadastroEntry = cadastroLookup.get(testCode);
                                break;
                            }
                            if (universalRegistry.has(testCode)) {
                                normalizedCode = testCode;
                                universalEntry = universalRegistry.get(testCode);
                                break;
                            }
                        }
                    }
                }

                // Prioritize finding the item ALREADY in the current group's stock
                const contextRegistryEntry = forcedGroupName
                    ? registries.find(r => normalizeText(r.groupName) === normalizeText(forcedGroupName))
                    : (scopedGroupNameSet.size > 0
                        ? registries.find(r => scopedGroupNameSet.has(normalizeText(r.groupName)))
                        : undefined);
                const globalRegistryEntry = registries[0];

                // Fallback to other groups' stock OR universalRegistry (global search)
                const fallbackEntry = contextRegistryEntry || globalRegistryEntry || universalEntry;
                const resolvedGroupName =
                    forcedGroupName ||
                    contextRegistryEntry?.groupName ||
                    fallbackEntry?.groupName ||
                    singleScopedGroupName ||
                    'DIVERSOS (SEM GRUPO)';

                const hierarchy = {
                    groupName: resolvedGroupName,
                    deptName: contextRegistryEntry?.deptName || localCadastroEntry?.deptName || fallbackEntry?.deptName || 'DIVERSOS (SEM DEPARTAMENTO)',
                    catName: contextRegistryEntry?.catName || localCadastroEntry?.catName || fallbackEntry?.catName || 'DIVERSOS (SEM CATEGORIA)'
                };

                const groupKey = `${hierarchy.groupName}|${hierarchy.deptName}|${hierarchy.catName}`;
                if (!groupedMap[groupKey]) {
                    groupedMap[groupKey] = {
                        groupName: hierarchy.groupName,
                        deptName: hierarchy.deptName,
                        catName: hierarchy.catName,
                        sysQty: 0,
                        sysCost: 0,
                        countedQty: 0,
                        countedCost: 0,
                        diffQty: 0,
                        diffCost: 0
                    };
                }
                groupedMap[groupKey].sysQty += sq;
                groupedMap[groupKey].sysCost += sc;
                groupedMap[groupKey].countedQty += cq;
                groupedMap[groupKey].countedCost += cc;
                groupedMap[groupKey].diffQty += dq;
                groupedMap[groupKey].diffCost += costDiff;

                items.push({
                    code,
                    description,
                    lab,
                    sysQty: sq,
                    sysCost: sc,
                    countedQty: cq,
                    countedCost: cc,
                    diffQty: dq,
                    diffCost: costDiff,
                    ...hierarchy
                });
            }

            // Convert map to sorted array (Sort by highest cost difference missing)
            const groupedDifferences = Object.values(groupedMap).sort((a, b) => a.diffCost - b.diffCost);

            const payload = {
                sysQty,
                sysCost,
                countedQty,
                countedCost,
                diffQty: diffQtySum,
                diffCost: diffCostSum,
                items,
                groupedDifferences
            };

            setTermComparisonMetrics(payload);
            setTermForm(prev => (prev ? { ...prev, excelMetrics: payload, excelMetricsRemovedAt: undefined } : prev));

            let nextDrafts: Record<string, TermForm> | null = null;
            if (termModal && termForm) {
                const key = buildTermKey(termModal);
                removedExcelDraftKeysRef.current.delete(key);
                const mutableDrafts: Record<string, TermForm> = { ...(termDrafts || {}) };
                const makeCatKey = (groupId?: string | number, deptId?: string | number, catId?: string | number) =>
                    partialScopeKey({ groupId, deptId, catId });
                const collectScopeCatKeys = (scope: { groupId?: string; deptId?: string; catId?: string }) =>
                    getScopeCategories(scope.groupId, scope.deptId, scope.catId)
                        .map(({ group, dept, cat }) => makeCatKey(group.id, dept.id, cat.id));
                const targetCatKeys = new Set<string>();
                if (termModal.type === 'custom') {
                    (termModal.customScopes || []).forEach(scope => {
                        collectScopeCatKeys(scope).forEach(k => targetCatKeys.add(k));
                    });
                } else {
                    collectScopeCatKeys(termModal).forEach(k => targetCatKeys.add(k));
                }
                const keyTouchesTarget = (draftKey: string) => {
                    if (targetCatKeys.size === 0) return draftKey === key;
                    if (draftKey.startsWith('custom|')) {
                        const match = draftKey.match(/^custom\|([^|]*)(?:\|(.*))?$/);
                        const scopesPart = typeof match?.[2] === 'string'
                            ? match[2]
                            : (match?.[1] || '');
                        const scopedKeys = scopesPart.split(',').filter(Boolean);
                        for (const scopeKey of scopedKeys) {
                            const [g, d, c] = scopeKey.split('|');
                            const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
                            for (const { group, dept, cat } of expanded) {
                                if (targetCatKeys.has(makeCatKey(group.id, dept.id, cat.id))) return true;
                            }
                        }
                        return false;
                    }
                    const [type, g, d, c] = draftKey.split('|');
                    if (!type || type === 'custom') return false;
                    const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
                    for (const { group, dept, cat } of expanded) {
                        if (targetCatKeys.has(makeCatKey(group.id, dept.id, cat.id))) return true;
                    }
                    return false;
                };

                Object.keys(mutableDrafts).forEach(draftKey => {
                    const current = mutableDrafts[draftKey];
                    if (!current || !keyTouchesTarget(draftKey)) return;
                    if (current.excelMetricsRemovedAt && !current.excelMetrics) {
                        mutableDrafts[draftKey] = { ...current, excelMetricsRemovedAt: undefined };
                    }
                    removedExcelDraftKeysRef.current.delete(draftKey);
                });

                nextDrafts = upsertScopeDraft(
                    mutableDrafts,
                    termModal,
                    { ...termForm, excelMetrics: payload, excelMetricsRemovedAt: undefined }
                );
                setTermDrafts(nextDrafts);
            }

            if (data) {
                const nextData = data;

                const savedSession = await persistAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'open',
                    data: {
                        ...nextData,
                        termDrafts: nextDrafts || ((nextData as any)?.termDrafts || termDrafts || {})
                    } as any,
                    progress: calculateProgress(nextData),
                    user_email: userEmail
                });
                if (!savedSession) {
                    throw new Error("Falha ao salvar atualização do Excel no Supabase.");
                }
                await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
                setDbSessionId(savedSession.id);
                setNextAuditNumber(savedSession.audit_number);
                const savedData = (savedSession.data as AuditData) || nextData;
                setData(savedData);
                setTermDrafts((((savedData as any)?.termDrafts || nextDrafts || {}) as Record<string, TermForm>));
            }

        } catch (err) {
            console.error("Erro ao processar Excel do Termo:", err);
            alert("Erro ao ler/salvar o arquivo Excel.");
            setTermComparisonMetrics(null);

            if (termModal && termForm) {
                const key = buildTermKey(termModal);
                setTermDrafts(current => {
                    const next = { ...current };
                    if (next[key]) next[key] = { ...next[key], excelMetrics: undefined };
                    return next;
                });
            }
        }

        // Reset input value to allow uploading the same file again if needed
        e.target.value = '';
    };

    const removeTermComparisonExcel = async () => {
        if (!isMaster) {
            alert("Apenas usuário master pode remover planilha do termo.");
            return;
        }
        setTermComparisonMetrics(null);
        const removedAt = new Date().toISOString();
        setTermForm(prev => (prev ? { ...prev, excelMetrics: undefined, excelMetricsRemovedAt: removedAt } : prev));
        if (termModal && termForm) {
            const tk = buildTermKey(termModal);
            const nextDrafts = { ...termDrafts };
            const makeCatKey = (groupId?: string | number, deptId?: string | number, catId?: string | number) =>
                partialScopeKey({ groupId, deptId, catId });
            const collectScopeCatKeys = (scope: { groupId?: string; deptId?: string; catId?: string }) =>
                getScopeCategories(scope.groupId, scope.deptId, scope.catId)
                    .map(({ group, dept, cat }) => makeCatKey(group.id, dept.id, cat.id));
            const targetCatKeys = new Set<string>();
            if (termModal.type === 'custom') {
                (termModal.customScopes || []).forEach(scope => {
                    collectScopeCatKeys(scope).forEach(k => targetCatKeys.add(k));
                });
            } else {
                collectScopeCatKeys(termModal).forEach(k => targetCatKeys.add(k));
            }
            const keyTouchesTarget = (draftKey: string) => {
                if (targetCatKeys.size === 0) return draftKey === tk;
                if (draftKey.startsWith('custom|')) {
                    // Compatibilidade: formato novo "custom|<batchId>|<scopes>"
                    // e legado "custom|<scopes>"
                    const match = draftKey.match(/^custom\|([^|]*)(?:\|(.*))?$/);
                    const scopesPart = typeof match?.[2] === 'string'
                        ? match[2]
                        : (match?.[1] || '');
                    const scopedKeys = scopesPart.split(',').filter(Boolean);
                    for (const scopeKey of scopedKeys) {
                        const [g, d, c] = scopeKey.split('|');
                        const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
                        for (const { group, dept, cat } of expanded) {
                            if (targetCatKeys.has(makeCatKey(group.id, dept.id, cat.id))) return true;
                        }
                    }
                    return false;
                }
                const [type, g, d, c] = draftKey.split('|');
                if (!type || type === 'custom') return false;
                const expanded = getScopeCategories(g || undefined, d || undefined, c || undefined);
                for (const { group, dept, cat } of expanded) {
                    if (targetCatKeys.has(makeCatKey(group.id, dept.id, cat.id))) return true;
                }
                return false;
            };

            Object.keys(nextDrafts).forEach(draftKey => {
                if (!nextDrafts[draftKey]?.excelMetrics) return;
                if (!keyTouchesTarget(draftKey)) return;
                nextDrafts[draftKey] = { ...nextDrafts[draftKey], excelMetrics: undefined, excelMetricsRemovedAt: removedAt };
                removedExcelDraftKeysRef.current.add(draftKey);
            });
            if (!nextDrafts[tk]) nextDrafts[tk] = { ...termForm, excelMetrics: undefined, excelMetricsRemovedAt: removedAt };
            else nextDrafts[tk] = { ...nextDrafts[tk], excelMetrics: undefined, excelMetricsRemovedAt: removedAt };
            removedExcelDraftKeysRef.current.add(tk);
            const legacyKey = getLegacyCustomTermKey(termModal);
            if (legacyKey && nextDrafts[legacyKey]) {
                nextDrafts[legacyKey] = { ...nextDrafts[legacyKey], excelMetrics: undefined, excelMetricsRemovedAt: removedAt };
                removedExcelDraftKeysRef.current.add(legacyKey);
            }
            setTermDrafts(nextDrafts);

            const nextData = data ? { ...data } : null;
            if (nextData) setData(nextData);

            if (isMaster && nextData) {
                const savedSession = await persistAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'open',
                    data: { ...nextData, termDrafts: nextDrafts } as any,
                    progress: calculateProgress(nextData),
                    user_email: userEmail
                });
                if (savedSession) {
                    await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
                    const savedData = (savedSession.data as AuditData) || nextData;
                    setData(savedData);
                    setTermDrafts((((savedData as any)?.termDrafts || nextDrafts || {}) as Record<string, TermForm>));
                } else {
                    throw new Error("Erro ao salvar remoção do Excel.");
                }
            }
        }
    };

    useEffect(() => {
        if (!termModal || typeof window === 'undefined' || typeof document === 'undefined') return;
        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeTermModal();
            }
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [termModal, closeTermModal]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleLookupShortcut = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                auditLookupInputRef.current?.focus();
                auditLookupInputRef.current?.select();
                setAuditLookupOpen(true);
            }
        };
        window.addEventListener('keydown', handleLookupShortcut);
        return () => window.removeEventListener('keydown', handleLookupShortcut);
    }, []);

    const buildTermScopeInfo = (scope: TermScope) => {
        if (!data) return null;
        const buildDeptLabel = (d: Department) => `${d.numericId || d.id} - ${d.name}`;
        const buildCatLabel = (c: Category) => `${c.numericId || c.id} - ${c.name}`;

        if (scope.type === 'custom') {
            const scopes = scope.customScopes || [];
            const departmentsMap = new Map<string, Department>();
            const categoriesMap = new Map<string, Category>();
            const products: { groupName: string; deptName: string; catName: string; code: string; name: string; quantity: number; cost: number }[] = [];
            const productKeys = new Set<string>();
            const groupLabels = new Set<string>();

            const pushProducts = (groupName: string, deptName: string, catName: string, cat: Category) => {
                cat.products.forEach(p => {
                    const key = `${groupName}|${deptName}|${catName}|${p.code}`;
                    if (productKeys.has(key)) return;
                    productKeys.add(key);
                    products.push({ groupName, deptName, catName, code: p.code, name: p.name, quantity: p.quantity, cost: p.cost || 0 });
                });
            };

            scopes.forEach(s => {
                const group = data.groups.find(g => g.id === s.groupId);
                if (!group) return;
                groupLabels.add(`${group.id} - ${group.name}`);

                if (!s.deptId && !s.catId) {
                    group.departments.forEach(d => {
                        departmentsMap.set(d.id, { ...d, name: buildDeptLabel(d) });
                        d.categories.forEach(c => {
                            categoriesMap.set(c.id, { ...c, name: buildCatLabel(c) });
                            pushProducts(group.name, d.name, c.name, c);
                        });
                    });
                    return;
                }

                let dept = s.deptId ? group.departments.find(d => d.id === s.deptId) : undefined;
                if (!dept && s.catId) {
                    dept = group.departments.find(d => d.categories.some(c => c.id === s.catId));
                }
                if (dept) {
                    departmentsMap.set(dept.id, { ...dept, name: buildDeptLabel(dept) });
                    if (!s.catId) {
                        dept.categories.forEach(c => {
                            categoriesMap.set(c.id, { ...c, name: buildCatLabel(c) });
                            pushProducts(group.name, dept!.name, c.name, c);
                        });
                        return;
                    }
                    const cat = dept.categories.find(c => c.id === s.catId);
                    if (cat) {
                        categoriesMap.set(cat.id, { ...cat, name: buildCatLabel(cat) });
                        pushProducts(group.name, dept.name, cat.name, cat);
                    }
                }
            });

            const departments = Array.from(departmentsMap.values());
            const categories = Array.from(categoriesMap.values());
            const group: Group = {
                id: 'custom',
                name: scope.customLabel || 'Contagens Personalizadas',
                departments: []
            };
            return {
                group,
                dept: undefined,
                cat: undefined,
                departments,
                categories,
                products,
                groupLabelText: Array.from(groupLabels).join(', ')
            };
        }

        const group = data.groups.find(g => g.id === scope.groupId);
        if (!group) return null;

        let dept: Department | undefined;
        let cat: Category | undefined;
        let departments: Department[] = [];
        let categories: Category[] = [];
        const products: { groupName: string; deptName: string; catName: string; code: string; name: string; quantity: number; cost: number }[] = [];

        if (scope.type === 'group') {
            departments = group.departments;
            categories = group.departments.flatMap(d => d.categories);
            group.departments.forEach(d => {
                d.categories.forEach(c => {
                    c.products.forEach(p => {
                        products.push({ groupName: group.name, deptName: d.name, catName: c.name, code: p.code, name: p.name, quantity: p.quantity, cost: p.cost || 0 });
                    });
                });
            });
        } else if (scope.type === 'department') {
            dept = group.departments.find(d => d.id === scope.deptId);
            if (dept) {
                departments = [dept];
                categories = dept.categories;
                dept.categories.forEach(c => {
                    c.products.forEach(p => {
                        products.push({ groupName: group.name, deptName: dept!.name, catName: c.name, code: p.code, name: p.name, quantity: p.quantity, cost: p.cost || 0 });
                    });
                });
            }
        } else {
            dept = group.departments.find(d => d.id === scope.deptId);
            cat = dept?.categories.find(c => c.id === scope.catId);
            if (dept && cat) {
                departments = [dept];
                categories = [cat];
                cat.products.forEach(p => {
                    products.push({ groupName: group.name, deptName: dept!.name, catName: cat!.name, code: p.code, name: p.name, quantity: p.quantity, cost: p.cost || 0 });
                });
            }
        }

        return { group, dept, cat, departments, categories, products };
    };

    const formatTermDate = (val?: string) => {
        if (!val) return new Date().toLocaleDateString('pt-BR');
        return val;
    };

    const handlePrintTerm = async () => {
        if (!data || !termModal || !termForm) return;
        const scopeInfo = buildTermScopeInfo(termModal);
        if (!scopeInfo) return;

        if (isMaster) {
            const key = buildTermKey(termModal);
            const persistedMetrics =
                termComparisonMetrics ||
                termForm.excelMetrics ||
                termDrafts[key]?.excelMetrics;
            const formToPersist = persistedMetrics
                ? { ...termForm, excelMetrics: persistedMetrics }
                : termForm;
            const nextDrafts = upsertScopeDraft(termDrafts, termModal, formToPersist);
            setTermDrafts(nextDrafts);
            try {
                // Persistence consolidated in audit_sessions (data field)
                const progress = calculateProgress(data || {} as any);
                const savedSession = await persistAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'open',
                    data: { ...data, termDrafts: nextDrafts } as any,
                    progress: progress,
                    user_email: userEmail
                });
                if (savedSession) {
                    await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
                }
            } catch (err) {
                console.error("Error saving term draft:", err);
            }
        }
        // @ts-ignore
        const { jsPDF } = (window as any).jspdf || {};
        if (!jsPDF) {
            alert('Biblioteca de PDF não carregada.');
            return;
        }

        const doc = new jsPDF('p', 'mm', 'a4');
        let y = 18;

        doc.setFontSize(16);
        doc.setTextColor(15, 23, 42);
        doc.text('TERMO DE AUDITORIA', 14, y);
        y += 8;

        doc.setFontSize(10);
        doc.setTextColor(60);
        const inventoryLine = `Nº INVENTÁRIO: ${termForm.inventoryNumber || '__________'} - ${formatTermDate(termForm.date)}`;
        doc.text(inventoryLine, 14, y);
        y += 6;
        doc.text(`Filial Auditada: Filial ${data.filial}`, 14, y);
        y += 6;
        const groupLabelForPdf = termModal.type === 'custom'
            ? `${(scopeInfo as any).groupLabelText || scopeInfo.group.name} (personalizado)`
            : scopeInfo.group.name;
        doc.text(`Grupo: ${groupLabelForPdf}`, 14, y);
        y += 6;

        const deptList = scopeInfo.departments.map(d => d.name).join(', ') || '-';
        const catList = scopeInfo.categories.map(c => c.name).join(', ') || '-';

        const deptLines = doc.splitTextToSize(`Departamentos: ${deptList}`, 180);
        doc.text(deptLines, 14, y);
        y += deptLines.length * 5;
        const catLines = doc.splitTextToSize(`Categorias: ${catList}`, 180);
        doc.text(catLines, 14, y);
        y += catLines.length * 5 + 2;

        const bodyText = [
            'Declaro que fui orientado e treinado sobre as melhores práticas de auditoria e procedimentos internos com relação ao estoque físico da empresa.',
            'Declaro também que participei ativamente do levantamento e contagem do estoque físico total desta filial conforme relatório de conferência anexo validado por mim.',
            'Portanto, estou ciente de que as informações apontadas nos relatórios em anexo são verdadeiras, assim como sou responsável pela contagem do estoque mensal e pela conservação do patrimônio da empresa.',
            'A inobservância dos procedimentos internos da empresa ou o apontamento de informações inverídicas no referido relatório ou termo, acarretará na aplicação das penalidades dispostas no Artigo 482, incisos, da Consolidação das Leis do Trabalho (CLT), ressalvadas, as demais sanções legais concomitantes.',
            'Os horários e datas constantes nos relatórios em anexo, são informações de uso exclusivo do setor de auditoria.'
        ].join(' ');

        const bodyLines = doc.splitTextToSize(bodyText, 180);
        doc.setTextColor(30);
        doc.text(bodyLines, 14, y);
        y += bodyLines.length * 5 + 2;

        const signatureRows = [
            [
                termForm.managerName2 ? `Gestor 1: ${termForm.managerName2}` : 'Gestor 1',
                termForm.managerCpf2 || '',
                termForm.managerSignature2 ? { content: '', sig: termForm.managerSignature2 } : '________________________'
            ],
            [
                termForm.managerName ? `Gestor 2: ${termForm.managerName}` : 'Gestor 2',
                termForm.managerCpf || '',
                termForm.managerSignature ? { content: '', sig: termForm.managerSignature } : '________________________'
            ],
            ...(termForm.collaborators.length ? termForm.collaborators : Array.from({ length: 10 }, () => ({ name: '', cpf: '', signature: '' }))).map((c, idx) => [
                c.name || `Colaborador ${idx + 1}`,
                c.cpf || '',
                c.signature ? { content: '', sig: c.signature } : '________________________'
            ])
        ];

        // @ts-ignore
        doc.autoTable({
            startY: y,
            head: [['Responsável', 'CPF', 'Ass.']],
            body: signatureRows,
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: { top: 1, right: 2, bottom: 3, left: 2 }, valign: 'bottom', halign: 'left' },
            columnStyles: {
                0: { cellWidth: 80 },
                1: { cellWidth: 45 },
                2: { cellWidth: 55, minCellHeight: 18 }
            },
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
            didDrawCell: (data: any) => {
                if (data.section !== 'body' || data.column.index !== 2) return;
                const raw = data.cell.raw as any;
                const sig = raw?.sig;
                if (typeof sig === 'string' && sig.startsWith('data:image')) {
                    const padding = 1;
                    const x = data.cell.x + padding;
                    const w = data.cell.width - padding * 2;
                    const h = Math.min(12, data.cell.height - padding * 2);
                    const y = data.cell.y + data.cell.height - h - padding;
                    doc.addImage(sig, 'PNG', x, y, w, h);
                }
            }
        });

        // @ts-ignore
        const afterSignY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 6 : y + 20;

        // 1. Tabela Base: Produtos Conferidos no Sistema
        const productHead = [['Grupo', 'Departamento', 'Categoria', 'Código', 'Produto', 'Qtd', 'Custo Unit', 'Custo Total']];
        const productBody = scopeInfo.products.map(p => [
            p.groupName,
            p.deptName,
            p.catName,
            p.code,
            p.name,
            Math.round(p.quantity).toLocaleString(),
            `R$ ${(p.cost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `R$ ${((p.cost || 0) * p.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ]);
        const productFoot = [[
            { content: 'TOTAIS DOS ITENS CONFERIDOS', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
            Math.round(scopeInfo.products.reduce((acc, p) => acc + p.quantity, 0)).toLocaleString(),
            '',
            `R$ ${scopeInfo.products.reduce((acc, p) => acc + (p.quantity * (p.cost || 0)), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ]];

        // @ts-ignore
        doc.autoTable({
            startY: afterSignY,
            head: productHead,
            body: productBody,
            foot: productFoot,
            theme: 'striped',
            styles: { fontSize: 7, cellPadding: 1.5 },
            headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
            footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
        });

        // @ts-ignore
        let afterProductTableY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 10 : afterSignY + 50;

        // 2. Tabela Opcional: Divergências Financeiras (Planilha Upload)
        if (termComparisonMetrics && termComparisonMetrics.items && termComparisonMetrics.items.length > 0) {

            // Quebra de página se tabelão de produtos ocupou muito espaço e não cabe nem o cabeçalho novo
            if (afterProductTableY > 240) {
                doc.addPage();
                afterProductTableY = 20;
            }

            doc.setFontSize(11);
            doc.setTextColor(15, 23, 42);
            doc.text('DIVERGÊNCIAS (PLANILHA DE CONFRONTO)', 14, afterProductTableY);

            const divHead = [['Cód', 'Descrição', 'Lab', 'Est Sist', 'Est Fis', 'Dif Qtd', 'Custo Físico', 'Dif R$']];
            const divBody = termComparisonMetrics.items.map(p => [
                p.code,
                p.description,
                p.lab,
                Math.round(p.sysQty).toLocaleString(),
                Math.round(p.countedQty).toLocaleString(),
                Math.round(p.diffQty).toLocaleString(),
                `R$ ${(p.countedCost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                `R$ ${(p.diffCost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ]);
            const divFoot = [[
                { content: 'TOTAIS DAS DIVERGÊNCIAS', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
                Math.round(termComparisonMetrics.sysQty).toLocaleString(),
                Math.round(termComparisonMetrics.countedQty).toLocaleString(),
                Math.round(termComparisonMetrics.diffQty).toLocaleString(),
                `R$ ${termComparisonMetrics.countedCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                `R$ ${termComparisonMetrics.diffCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ]];

            // @ts-ignore
            doc.autoTable({
                startY: afterProductTableY + 6,
                head: divHead,
                body: divBody,
                foot: divFoot,
                theme: 'striped',
                styles: { fontSize: 7, cellPadding: 1.5 },
                headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
                footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
            });

            // @ts-ignore
            afterProductTableY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 10 : afterProductTableY + 50;

            // 3. Tabela Opcional: Resumo de Divergências por Categoria
            if (termComparisonMetrics.groupedDifferences && termComparisonMetrics.groupedDifferences.length > 0) {
                if (afterProductTableY > 240) {
                    doc.addPage();
                    afterProductTableY = 20;
                }

                doc.setFontSize(11);
                doc.setTextColor(15, 23, 42);
                doc.text('RESUMO DE DIVERGÊNCIAS POR CATEGORIA', 14, afterProductTableY);

                const groupHead = [['Hierarquia (Grupo > Depto > Categoria)', 'Dif Qtd', 'Prejuízo/Sobra']];
                const groupBody = termComparisonMetrics.groupedDifferences.map((g: any) => [
                    `${g.groupName} > ${g.deptName} > ${g.catName}`,
                    `${g.diffQty > 0 ? '+' : ''}${Math.round(g.diffQty).toLocaleString('pt-BR')} un.`,
                    `R$ ${g.diffCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                ]);

                // @ts-ignore
                doc.autoTable({
                    startY: afterProductTableY + 6,
                    head: groupHead,
                    body: groupBody,
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255] }, // Indigo-500
                    didParseCell: (hookData: any) => {
                        if (hookData.section === 'body' && hookData.column.index === 2) {
                            const valStr = hookData.cell.raw.toString();
                            if (valStr.includes('-')) {
                                hookData.cell.styles.textColor = [220, 38, 38]; // Red
                                hookData.cell.styles.fontStyle = 'bold';
                            } else if (valStr !== 'R$ 0,00' && valStr !== 'R$ -0,00') {
                                hookData.cell.styles.textColor = [22, 163, 74]; // Green
                                hookData.cell.styles.fontStyle = 'bold';
                            }
                        }
                    }
                });

                // @ts-ignore
                afterProductTableY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 10 : afterProductTableY + 30;
            }
        }

        let finalY = afterProductTableY;

        if (termComparisonMetrics) {
            // Check if we need a new page for the summary
            if (finalY > 250) {
                doc.addPage();
                finalY = 20;
            }

            doc.setFontSize(11);
            doc.setTextColor(15, 23, 42);
            doc.text('RESUMO FINANCEIRO DA CONFERÊNCIA', 14, finalY);
            finalY += 6;

            const diffType = termComparisonMetrics.diffCost < 0 ? 'Prejuízo (Falta)' : termComparisonMetrics.diffCost > 0 ? 'Sobra (Excesso)' : 'Zero';
            const scopeAuditedCost = (scopeInfo.products || []).reduce((sum: number, p: any) => sum + ((p.quantity || 0) * (p.cost || 0)), 0);
            const representativity = getFinancialRepresentativity(scopeAuditedCost, termComparisonMetrics.diffCost);
            const representativityLabel = representativity === null
                ? 'N/A'
                : `${representativity.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

            const summaryRows = [
                ['Estoque Sistema (Qtde)', Math.round(termComparisonMetrics.sysQty).toLocaleString('pt-BR')],
                ['Custo Total Sistema', termComparisonMetrics.sysCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })],
                ['Estoque Físico (Qtde)', Math.round(termComparisonMetrics.countedQty).toLocaleString('pt-BR')],
                ['Custo Total Físico', termComparisonMetrics.countedCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })],
                ['Diferença de Estoque (Qtde)', termComparisonMetrics.diffQty.toLocaleString('pt-BR')],
                ['Resultado Financeiro', termComparisonMetrics.diffCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + ` (${diffType})`],
                ['Representatividade no Auditado', representativityLabel]
            ];

            // @ts-ignore
            doc.autoTable({
                startY: finalY,
                body: summaryRows,
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 2 },
                columnStyles: {
                    0: { cellWidth: 80, fontStyle: 'bold', fillColor: [248, 250, 252] },
                    1: { cellWidth: 60, halign: 'right' }
                },
                didParseCell: (hookData: any) => {
                    if (hookData.row.index === 5 && hookData.column.index === 1) { // Resultado Financeiro value cell
                        hookData.cell.styles.fontStyle = 'bold';
                        if (termComparisonMetrics.diffCost < 0) {
                            hookData.cell.styles.textColor = [220, 38, 38]; // Red
                        } else if (termComparisonMetrics.diffCost > 0) {
                            hookData.cell.styles.textColor = [22, 163, 74]; // Green
                        }
                    }
                }
            });
        }

        const safeName = scopeInfo.group.name.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 30);
        const termTypeFile = termModal.type === 'custom' ? 'personalizado' : termModal.type;
        const fileName = `Termo_Auditoria_F${data.filial}_${termTypeFile}_${safeName}.pdf`;
        insertAppEventLog({
            company_id: selectedCompany?.id || null,
            branch: selectedFilial || null,
            area: null,
            user_email: userEmail,
            user_name: userName || null,
            app: 'auditoria',
            event_type: 'audit_term_printed',
            entity_type: 'audit_term',
            entity_id: fileName,
            status: 'success',
            success: true,
            source: 'web',
            event_meta: { type: termModal.type, group: scopeInfo.group.name }
        }).catch(() => { });
        doc.save(fileName);
    };
    const calculateProgress = useCallback((auditData: AuditData) => {
        let skus = 0, doneSkus = 0;
        if (auditData.groups) {
            auditData.groups.forEach(g => g.departments.forEach(d => d.categories.forEach(c => {
                skus += c.itemsCount;
                if (isDoneStatus(c.status)) doneSkus += c.itemsCount;
            })));
        }
        return skus > 0 ? (doneSkus / skus) * 100 : 0;
    }, []);

    const applyPartialScopes = useCallback((base: AuditData, partials: Array<{ startedAt: string; groupId?: string; deptId?: string; catId?: string }>) => {
        const partialMap = new Map<string, { startedAt: string; groupId?: string; deptId?: string; catId?: string }>();
        (partials || []).forEach(p => {
            if (!p?.startedAt) return;
            base.groups.forEach(g => {
                if (!isPartialScopeMatch(p, g.id)) return;
                g.departments.forEach(d => {
                    if (!isPartialScopeMatch(p, g.id, d.id)) return;
                    d.categories.forEach(c => {
                        if (!isPartialScopeMatch(p, g.id, d.id, c.id)) return;
                        const current = normalizeAuditStatus(c.status);
                        if (current === AuditStatus.DONE) return;
                        const key = partialScopeKey({ groupId: g.id, deptId: d.id, catId: c.id });
                        const existing = partialMap.get(key);
                        if (!existing) {
                            partialMap.set(key, {
                                startedAt: p.startedAt,
                                groupId: normalizeScopeId(g.id),
                                deptId: normalizeScopeId(d.id),
                                catId: normalizeScopeId(c.id)
                            });
                        }
                    });
                });
            });
        });
        const normalizedPartials = Array.from(partialMap.values());
        return {
            ...base,
            partialStarts: normalizedPartials,
            partialCompleted: base.partialCompleted || [],
            groups: base.groups.map(g => ({
                ...g,
                departments: g.departments.map(d => ({
                    ...d,
                    categories: d.categories.map(c => {
                        const current = normalizeAuditStatus(c.status);
                        if (current === AuditStatus.DONE) return { ...c, status: current };
                        const matched = normalizedPartials.some(p => isPartialScopeMatch(p, g.id, d.id, c.id));
                        return { ...c, status: matched ? AuditStatus.IN_PROGRESS : AuditStatus.TODO };
                    })
                }))
            }))
        };
    }, []);

    const clearPartialProgress = useCallback(async (
        reason?: 'expired' | 'manual' | 'invalid',
        discardCompleted = false,
        suppressExpiredAlert = false
    ) => {
        // Regra de segurança: nunca mais limpar automaticamente por "expiração".
        // Contagens finalizadas não podem ser afetadas por esse fluxo.
        if (reason === 'expired') return;
        if (!data?.partialStarts || data.partialStarts.length === 0) return;
        const nextData = applyPartialScopes(
            discardCompleted ? { ...data, partialCompleted: [] } : data,
            []
        );
        setData(nextData);
        try {
            const progress = calculateProgress(nextData);
            const savedSession = await persistAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts: ((nextData as any)?.termDrafts || (data as any)?.termDrafts || termDrafts || {}) } as any,
                progress: progress,
                user_email: userEmail
            }, { allowProgressRegression: true });
            if (savedSession) {
                await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
            }
            insertAppEventLog({
                company_id: selectedCompany?.id || null,
                branch: selectedFilial || null,
                area: null,
                user_email: userEmail,
                user_name: userName || null,
                app: 'auditoria',
                event_type: 'audit_partial_pause',
                entity_type: 'partial_scope',
                entity_id: selectedFilial || null,
                status: 'success',
                success: true,
                source: 'web',
                event_meta: { reason: reason || 'manual', discarded_completed: discardCompleted }
            }).catch(() => { });

            if (reason === 'expired' && !suppressExpiredAlert && !isUpdatingStock) {
                if (sessionStorage.getItem(PARTIAL_EXPIRED_ALERT_KEY) !== '1') {
                    sessionStorage.setItem(PARTIAL_EXPIRED_ALERT_KEY, '1');
                    alert("Contagem parcial expirada. Inicie novamente para continuar.");
                }
            } else if (reason !== 'expired') {
                sessionStorage.removeItem(PARTIAL_EXPIRED_ALERT_KEY);
            }
        } catch (err) {
            console.error("Error clearing partial:", err);
        }
    }, [data, dbSessionId, selectedFilial, nextAuditNumber, applyPartialScopes, calculateProgress, isUpdatingStock, PARTIAL_EXPIRED_ALERT_KEY]);

    const finalizeActivePartials = useCallback(async () => {
        if (!data?.partialStarts || data.partialStarts.length === 0) return;
        if (!isMaster) {
            alert("Apenas usuário master pode concluir contagens parciais.");
            return;
        }
        if (!window.confirm("Deseja concluir todas as contagens parciais ativas?")) return;

        const toComplete = data.partialStarts;
        const completedAt = new Date().toISOString();
        const batchId = createBatchId();
        const merged = [
            ...(data.partialCompleted || []),
            ...toComplete.map(p => ({ ...p, completedAt, batchId }))
        ];
        const dedupedMap = new Map<string, { startedAt?: string; completedAt: string; batchId?: string; groupId?: string; deptId?: string; catId?: string }>();
        merged.forEach(p => {
            dedupedMap.set(partialCompletedKey(p), p);
        });
        const nextCompleted = Array.from(dedupedMap.values());

        const inScope = (p: { groupId?: string; deptId?: string; catId?: string }, g: Group, d: Department, c: Category) =>
            isPartialScopeMatch(p, g.id, d.id, c.id);

        const nextDataRaw: AuditData = {
            ...data,
            partialStarts: [],
            partialCompleted: nextCompleted,
            lastPartialBatchId: batchId,
            groups: data.groups.map(g => ({
                ...g,
                departments: g.departments.map(d => ({
                    ...d,
                    categories: d.categories.map(c => {
                        const current = normalizeAuditStatus(c.status);
                        if (current === AuditStatus.DONE) return { ...c, status: current };
                        const shouldFinalize = toComplete.some(p => inScope(p, g, d, c));
                        if (shouldFinalize) return { ...c, status: AuditStatus.DONE };
                        return { ...c, status: current };
                    })
                }))
            }))
        };

        const nextData = applyPartialScopes(nextDataRaw, []);
        setData(nextData);

        try {
            // Persistence consolidated in audit_sessions (data field)
            const progress = calculateProgress(nextData);
            const savedSession = await persistAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts: ((nextData as any)?.termDrafts || (data as any)?.termDrafts || termDrafts || {}) } as any,
                progress: progress,
                user_email: userEmail
            }, { allowProgressRegression: true });
            if (savedSession) {
                await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
            }
            insertAppEventLog({
                company_id: selectedCompany?.id || null,
                branch: selectedFilial || null,
                area: null,
                user_email: userEmail,
                user_name: userName || null,
                app: 'auditoria',
                event_type: 'audit_partial_finalize',
                entity_type: 'partial_batch',
                entity_id: batchId,
                status: 'success',
                success: true,
                source: 'web',
                event_meta: { total_scopes: toComplete.length }
            }).catch(() => { });
            alert("Contagens parciais concluídas.");

        } catch (err) {
            console.error("Error finalizing partials:", err);
            alert("Erro ao concluir contagens parciais no Supabase.");
        }
    }, [data, dbSessionId, selectedFilial, nextAuditNumber, applyPartialScopes, calculateProgress, isMaster]);

    const clearActivePartialsShortcut = useCallback(async () => {
        if (!data?.partialStarts || data.partialStarts.length === 0) return;
        if (!window.confirm("Deseja desfazer todas as contagens parciais ativas?")) return;
        await clearPartialProgress('manual', false);
    }, [data, clearPartialProgress]);

    const startScopeAudit = async (groupId?: string, deptId?: string, catId?: string) => {
        if (!data) return;
        sessionStorage.removeItem(PARTIAL_EXPIRED_ALERT_KEY);
        const scopeCatsGuard = getScopeCategories(groupId, deptId, catId);
        const scopeOpenCats = scopeCatsGuard.filter(({ cat }) => !isDoneStatus(cat.status));
        if (scopeOpenCats.length === 0) {
            alert("Este escopo já está 100% finalizado. A contagem parcial só pode incluir categorias pendentes.");
            return;
        }
        const nowIso = new Date().toISOString();
        const existing = data?.partialStarts || [];
        const catMap = new Map<string, { startedAt: string; groupId: string; deptId: string; catId: string }>();

        existing.forEach(p => {
            const expanded = getScopeCategories(p.groupId, p.deptId, p.catId);
            expanded.forEach(({ group, dept, cat }) => {
                if (isDoneStatus(cat.status)) return;
                const key = partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id });
                if (!catMap.has(key)) {
                    catMap.set(key, {
                        startedAt: p.startedAt || nowIso,
                        groupId: normalizeScopeId(group.id),
                        deptId: normalizeScopeId(dept.id),
                        catId: normalizeScopeId(cat.id)
                    });
                }
            });
        });

        const scopeCats = scopeOpenCats;
        const scopeKeys = scopeCats.map(({ group, dept, cat }) => partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id }));
        const allSelected = scopeKeys.length > 0 && scopeKeys.every(k => catMap.has(k));

        if (allSelected) {
            scopeKeys.forEach(k => catMap.delete(k));
        } else {
            scopeCats.forEach(({ group, dept, cat }) => {
                const key = partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id });
                catMap.set(key, {
                    startedAt: nowIso,
                    groupId: normalizeScopeId(group.id),
                    deptId: normalizeScopeId(dept.id),
                    catId: normalizeScopeId(cat.id)
                });
            });
        }

        const nextPartials = Array.from(catMap.values());
        const nextData = applyPartialScopes(data, nextPartials);

        setData(nextData);

        try {
            const progress = calculateProgress(nextData);
            const savedSession = await persistAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts: ((nextData as any)?.termDrafts || (data as any)?.termDrafts || termDrafts || {}) } as any,
                progress: progress,
                user_email: userEmail
            });
            if (savedSession) {
                await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
            }
            insertAppEventLog({
                company_id: selectedCompany?.id || null,
                branch: selectedFilial || null,
                area: null,
                user_email: userEmail,
                user_name: userName || null,
                app: 'auditoria',
                event_type: allSelected ? 'audit_partial_pause' : 'audit_partial_start',
                entity_type: 'partial_scope',
                entity_id: `${groupId || ''}:${deptId || ''}:${catId || ''}`,
                status: 'success',
                success: true,
                source: 'web',
                event_meta: { groupId, deptId, catId }
            }).catch(() => { });
            alert(allSelected ? "Contagem parcial desativada." : "Auditoria iniciada. Contagem parcial registrada.");
        } catch (err) {
            console.error("Error persisting start:", err);
            alert("Erro ao registrar início no Supabase. O progresso foi salvo localmente.");
        }
    };

    const toggleScopeStatus = async (groupId?: string, deptId?: string, catId?: string) => {
        if (!data) return;
        if (!isMaster) {
            alert("Apenas usuário master pode concluir ou desativar contagens parciais.");
            return;
        }

        const scopeCats: Category[] = [];
        data.groups.forEach(g => {
            if (groupId && g.id !== groupId) return;
            g.departments.forEach(d => {
                if (deptId && d.id !== deptId) return;
                d.categories.forEach(c => {
                    if (catId && c.id !== catId) return;
                    scopeCats.push(c);
                });
            });
        });

        const hasStarted = scopeCats.some(c => normalizeAuditStatus(c.status) !== AuditStatus.TODO);
        if (!hasStarted) {
            alert("Inicie a auditoria parcial antes de concluir.");
            return;
        }

        // Determinar se o escopo atual já está todo concluído
        let allDone = true;
        data.groups.forEach(g => {
            if (groupId && g.id !== groupId) return;
            g.departments.forEach(d => {
                if (deptId && d.id !== deptId) return;
                d.categories.forEach(c => {
                    if (catId && c.id !== catId) return;
                    if (!isDoneStatus(c.status)) allDone = false;
                });
            });
        });

        const isUnmarkFlow = allDone;
        if (isUnmarkFlow) {
            if (!window.confirm("Tem certeza que deseja desmarcar este escopo finalizado?")) return;
            const typed = window.prompt("Confirmação de segurança: digite DESMARCAR para continuar.");
            if ((typed || '').trim().toUpperCase() !== 'DESMARCAR') return;
        } else {
            if (!window.confirm("Tem certeza que deseja finalizar e gravar o estoque no Supabase?")) return;
        }

        const targetScopeCatKeys = new Set(
            getScopeCategories(groupId, deptId, catId).map(({ group, dept, cat }) =>
                partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id })
            )
        );
        const entryTouchesTargetScope = (entry: { groupId?: string; deptId?: string; catId?: string }) => {
            if (targetScopeCatKeys.size === 0) return scopeContainsPartial(entry, groupId, deptId, catId);
            const expanded = getScopeCategories(entry.groupId, entry.deptId, entry.catId);
            for (const { group, dept, cat } of expanded) {
                const key = partialScopeKey({ groupId: group.id, deptId: dept.id, catId: cat.id });
                if (targetScopeCatKeys.has(key)) return true;
            }
            return false;
        };
        const existingPartials = data?.partialStarts || [];
        const filteredPartials = existingPartials.filter(p => !entryTouchesTargetScope(p));
        const baseCompleted = isUnmarkFlow
            ? (data.partialCompleted || []).filter(p => !entryTouchesTargetScope(p))
            : (data.partialCompleted || []);
        let nextCompleted = baseCompleted;
        let nextBatchId = data.lastPartialBatchId;
        if (isUnmarkFlow) {
            nextBatchId = getLatestBatchId(baseCompleted);
        } else {
            const completedAt = new Date().toISOString();
            const batchId = createBatchId();
            const scopeEntry = {
                completedAt,
                batchId,
                groupId: normalizeScopeId(groupId),
                deptId: normalizeScopeId(deptId),
                catId: normalizeScopeId(catId)
            };
            const map = new Map<string, any>();
            baseCompleted.forEach(p => map.set(partialCompletedKey(p), p));
            map.set(partialCompletedKey(scopeEntry), scopeEntry);
            nextCompleted = Array.from(map.values());
            nextBatchId = batchId;
        }

        const nextDataRaw: AuditData = {
            ...data,
            partialStarts: filteredPartials,
            partialCompleted: nextCompleted,
            lastPartialBatchId: nextBatchId,
            groups: data.groups.map(g => {
                if (groupId && g.id !== groupId) return g;
                return {
                    ...g,
                    departments: g.departments.map(d => {
                        if (deptId && d.id !== deptId) return d;
                        return {
                            ...d,
                            categories: d.categories.map(c => {
                                if (catId && c.id !== catId) return c;
                                if (isUnmarkFlow) return { ...c, status: AuditStatus.TODO };
                                if (isDoneStatus(c.status)) return c;
                                return { ...c, status: AuditStatus.DONE };
                            })
                        };
                    })
                };
            })
        };

        const nextData = applyPartialScopes(nextDataRaw, filteredPartials);
        const nextDrafts = termDrafts;

        const nextDataWithTerms = { ...nextData, termDrafts: nextDrafts } as any;
        setData(nextDataWithTerms);

        try {
            const progress = calculateProgress(nextDataWithTerms);
            const savedSession = await persistAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: nextDataWithTerms,
                progress: progress,
                user_email: userEmail
            }, { allowProgressRegression: isUnmarkFlow });
            if (savedSession) {
                await CacheService.set(`audit_session_${selectedFilial}`, savedSession as any);
            }
            insertAppEventLog({
                company_id: selectedCompany?.id || null,
                branch: selectedFilial || null,
                area: null,
                user_email: userEmail,
                user_name: userName || null,
                app: 'auditoria',
                event_type: isUnmarkFlow ? 'audit_partial_pause' : 'audit_partial_finalize',
                entity_type: 'partial_scope',
                entity_id: `${groupId || ''}:${deptId || ''}:${catId || ''}`,
                status: 'success',
                success: true,
                source: 'web',
                event_meta: { groupId, deptId, catId, action: isUnmarkFlow ? 'unmark' : 'finalize' }
            }).catch(() => { });
            alert(isUnmarkFlow
                ? "Escopo desmarcado com sucesso."
                : "Estoque gravado no Supabase com sucesso!");

        } catch (err) {
            console.error("Error persisting toggle:", err);
            alert("Erro ao gravar no Supabase. O progresso foi salvo localmente.");
        }
    };

    const handleExportPDF = async () => {
        if (!data) return;
        const jsPDF = (window as any).jspdf?.jsPDF;
        if (!jsPDF) {
            alert("Biblioteca jsPDF não encontrada.");
            return;
        }
        const doc = new jsPDF('l', 'mm', 'a4');
        const ts = new Date().toLocaleString('pt-BR');

        doc.setFontSize(22); doc.setTextColor(15, 23, 42);
        doc.text(`INVENTÁRIO ANALÍTICO: FILIAL ${data.filial}`, 14, 22);
        doc.setFontSize(10); doc.setTextColor(100);
        doc.text(`${data.empresa} - Emitido em: ${ts}`, 14, 30);
        doc.line(14, 34, 282, 34);

        const summaryData = [
            ["PREVISÃO DE TÉRMINO", `${Math.ceil(productivity.etaDays)} dias restantes`, "CONFERÊNCIA (SKUs)", `${Math.round(branchMetrics.progress)}%`],
            ["SKUs TOTAIS (Relatório)", branchMetrics.skus.toLocaleString(), "UNIDADES TOTAIS (Relatório)", Math.round(branchMetrics.units).toLocaleString()],
            ["SKUs CONFERIDOS", branchMetrics.doneSkus.toLocaleString(), "UNIDADES CONFERIDAS", Math.round(branchMetrics.doneUnits).toLocaleString()],
            ["SKUs FALTANTES", branchMetrics.pendingSkus.toLocaleString(), "UNIDADES FALTANTES", Math.round(branchMetrics.pendingUnits).toLocaleString()],
            ["VALOR TOTAL (Custo)", `R$ ${branchMetrics.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, "VALOR CONFERIDO", `R$ ${branchMetrics.doneCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`]
        ];

        if ((doc as any).autoTable) {
            (doc as any).autoTable({ startY: 40, body: summaryData, theme: 'grid', styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [79, 70, 229] } });
        }

        doc.addPage();
        doc.setFontSize(16); doc.setTextColor(15, 23, 42);
        doc.text("BALANÇO ANALÍTICO HIERÁRQUICO (TOTAL vs CONFERIDO)", 14, 20);

        const hierarchyRows: any[] = [];
        data.groups.forEach(g => {
            const gm = calcScopeMetrics(g);
            hierarchyRows.push([
                { content: `GRUPO: ${g.name} (ID ${g.id})`, styles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' } },
                gm.skus, gm.doneSkus, `${Math.round(gm.progress)}%`,
                Math.round(gm.units).toLocaleString(), Math.round(gm.doneUnits).toLocaleString(), `${Math.round(gm.progressUnits)}%`,
                `R$ ${gm.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, `R$ ${gm.doneCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ]);

            g.departments.forEach(d => {
                const dm = calcScopeMetrics(d);
                hierarchyRows.push([
                    { content: `  > DEPARTAMENTO: ${d.name} (${d.numericId || '--'})`, styles: { fillColor: [241, 245, 249], fontStyle: 'bold' } },
                    dm.skus, dm.doneSkus, `${Math.round(dm.progress)}%`,
                    Math.round(dm.units).toLocaleString(), Math.round(dm.doneUnits).toLocaleString(), `${Math.round(dm.progressUnits)}%`,
                    `R$ ${dm.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, `R$ ${dm.doneCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                ]);

                d.categories.forEach(c => {
                    const isDone = isDoneStatus(c.status);
                    hierarchyRows.push([
                        `      - ${c.name} (${c.numericId || "--"})`,
                        c.itemsCount, isDone ? c.itemsCount : 0, isDone ? "100%" : "0%",
                        c.totalQuantity.toLocaleString(), isDone ? c.totalQuantity.toLocaleString() : "0", isDone ? "100%" : "0%",
                        `R$ ${c.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, isDone ? `R$ ${c.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "R$ 0,00"
                    ]);
                });
            });
        });

        if ((doc as any).autoTable) {
            (doc as any).autoTable({
                startY: 30,
                head: [['Hierarquia de Inventário (Grupo > Depto > Cat)', 'Mix Total', 'Mix Conf.', 'Prog Mix', 'Unid Total', 'Unid Conf.', 'Prog Unid', 'Custo Total', 'Custo Conf.']],
                body: hierarchyRows,
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 1.5 },
                headStyles: { fillColor: [15, 23, 42] }
            });
        }

        const fileName = `Auditoria_F${data.filial}_Analitica.pdf`;
        insertAppEventLog({
            company_id: selectedCompany?.id || null,
            branch: selectedFilial || null,
            area: null,
            user_email: userEmail,
            user_name: userName || null,
            app: 'auditoria',
            event_type: 'audit_report_printed',
            entity_type: 'audit_report',
            entity_id: fileName,
            status: 'success',
            success: true,
            source: 'web'
        }).catch(() => { });
        doc.save(fileName);
    };

    const selectedGroup = useMemo(() => data?.groups.find(g => g.id === view.selectedGroupId), [data, view.selectedGroupId]);
    const selectedDept = useMemo(() => selectedGroup?.departments.find(d => d.id === view.selectedDeptId), [selectedGroup, view.selectedDeptId]);
    const selectedCat = useMemo(() => selectedDept?.categories.find(c => c.id === view.selectedCatId), [selectedDept, view.selectedCatId]);

    const auditLookupIndex = useMemo(() => {
        if (!data) return [] as Array<{
            groupId: string;
            groupName: string;
            deptId: string;
            deptName: string;
            catId: string;
            catName: string;
            productName: string;
            barcode: string;
            reducedCode: string;
            searchText: string;
        }>;

        return data.groups.flatMap(group =>
            group.departments.flatMap(dept =>
                dept.categories.flatMap(cat =>
                    cat.products.map(product => {
                        const barcode = String(product.code || '').trim();
                        const reducedCode = String(product.reducedCode || '').trim();
                        return {
                            groupId: group.id,
                            groupName: group.name,
                            deptId: dept.id,
                            deptName: dept.name,
                            catId: cat.id,
                            catName: cat.name,
                            productName: product.name,
                            barcode,
                            reducedCode,
                            searchText: normalizeLookupText(
                                `${barcode} ${reducedCode} ${product.name} ${group.id} ${group.name} ${dept.id} ${dept.name} ${cat.id} ${cat.name}`
                            )
                        };
                    })
                )
            )
        );
    }, [data]);

    const normalizedAuditLookup = useMemo(() => normalizeLookupText(auditLookup), [auditLookup]);
    const auditLookupResults = useMemo(() => {
        if (!normalizedAuditLookup) return [] as typeof auditLookupIndex;
        return auditLookupIndex
            .filter(item => item.searchText.includes(normalizedAuditLookup))
            .slice(0, 25);
    }, [auditLookupIndex, normalizedAuditLookup]);
    const handleOpenAuditLookupResult = useCallback((result: (typeof auditLookupIndex)[number]) => {
        setView({
            level: 'products',
            selectedGroupId: result.groupId,
            selectedDeptId: result.deptId,
            selectedCatId: result.catId
        });
        setAuditLookup('');
        setAuditLookupOpen(false);
    }, []);
    const termScopeInfo = useMemo(() => (termModal ? buildTermScopeInfo(termModal) : null), [termModal, data]);
    const partialInfoList = useMemo(() => {
        if (!data?.partialStarts || data.partialStarts.length === 0) return [];
        const buildDeptLabel = (d: Department) => `${d.numericId || d.id} - ${d.name}`;
        const buildCatLabel = (c: Category) => `${c.numericId || c.id} - ${c.name}`;

        const bucket = new Map<string, {
            key: string;
            groupLabel: string | null;
            deptLabel: string | null;
            catItems: string[];
            catIds: Set<string>;
            skus: number;
            units: number;
            startedAt?: string;
        }>();

        const addCat = (group: Group, dept: Department, cat: Category, startedAt: string) => {
            const key = `${normalizeScopeId(group.id)}|${normalizeScopeId(dept.id)}`;
            const entry = bucket.get(key) || {
                key,
                groupLabel: `${group.id} - ${group.name}`,
                deptLabel: buildDeptLabel(dept),
                catItems: [],
                catIds: new Set<string>(),
                skus: 0,
                units: 0,
                startedAt
            };
            const catKey = normalizeScopeId(cat.id);
            if (!entry.catIds.has(catKey)) {
                entry.catIds.add(catKey);
                entry.catItems.push(buildCatLabel(cat));
                entry.skus += cat.itemsCount;
                entry.units += cat.totalQuantity;
            }
            if (!entry.startedAt || new Date(startedAt).getTime() < new Date(entry.startedAt).getTime()) {
                entry.startedAt = startedAt;
            }
            bucket.set(key, entry);
        };

        data.partialStarts.forEach(scope => {
            const startedAt = scope.startedAt || new Date().toISOString();
            const expanded = getScopeCategories(scope.groupId, scope.deptId, scope.catId);
            expanded.forEach(({ group, dept, cat }) => addCat(group, dept, cat, startedAt));
        });

        return Array.from(bucket.values()).map(entry => ({
            key: entry.key,
            groupLabel: entry.groupLabel,
            deptLabel: entry.deptLabel,
            catItems: entry.catItems,
            skus: entry.skus,
            units: entry.units,
            startedAtLabel: entry.startedAt
                ? new Date(entry.startedAt).toLocaleString('pt-BR', { hour12: false })
                : ''
        }));
    }, [data]);

    const partialTotals = useMemo(() => {
        if (!data?.partialStarts || data.partialStarts.length === 0) return { skus: 0, units: 0 };
        const seenCats = new Set<string>();
        let skus = 0;
        let units = 0;
        data.partialStarts.forEach(scope => {
            const expanded = getScopeCategories(scope.groupId, scope.deptId, scope.catId);
            expanded.forEach(({ cat }) => {
                const catKey = normalizeScopeId(cat.id);
                if (seenCats.has(catKey)) return;
                seenCats.add(catKey);
                skus += cat.itemsCount;
                units += cat.totalQuantity;
            });
        });
        return { skus, units };
    }, [data]);

    const completedInfoList = useMemo(() => {
        if (!data?.partialCompleted || data.partialCompleted.length === 0) return [];
        const byKey = new Map<string, {
            key: string;
            label: string;
            scope: { groupId?: string; deptId?: string; catId?: string };
            completedAtLabel: string;
        }>();

        const findGroup = (groupId?: string | number) =>
            data.groups.find(g => normalizeScopeId(g.id) === normalizeScopeId(groupId));

        const findDept = (group?: Group, deptId?: string | number) =>
            group?.departments.find(d => normalizeScopeId(d.id) === normalizeScopeId(deptId));

        data.partialCompleted.forEach(scope => {
            const key = partialCompletedKey(scope);
            if (byKey.has(key)) return;
            const group = findGroup(scope.groupId);
            const dept = scope.deptId ? findDept(group, scope.deptId) : undefined;
            const cat = scope.catId
                ? (dept?.categories.find(c => normalizeScopeId(c.id) === normalizeScopeId(scope.catId)) ||
                    group?.departments.flatMap(d => d.categories).find(c => normalizeScopeId(c.id) === normalizeScopeId(scope.catId)))
                : undefined;

            let label = 'Escopo personalizado';
            if (cat) {
                label = `Cat ${cat.numericId || cat.id} - ${cat.name}`;
            } else if (dept) {
                label = `Depto ${dept.numericId || dept.id} - ${dept.name}`;
            } else if (group) {
                label = `Grupo ${group.id} - ${group.name}`;
            }

            byKey.set(key, {
                key,
                label,
                scope: {
                    groupId: normalizeScopeId(scope.groupId),
                    deptId: normalizeScopeId(scope.deptId),
                    catId: normalizeScopeId(scope.catId)
                },
                completedAtLabel: scope.completedAt
                    ? new Date(scope.completedAt).toLocaleString('pt-BR', { hour12: false })
                    : ''
            });
        });

        return Array.from(byKey.values());
    }, [data]);

    const openPartialTerm = (scope: { groupId?: string; deptId?: string; catId?: string }) => {
        if (!scope.groupId) return;
        const type: TermScopeType = scope.catId ? 'category' : scope.deptId ? 'department' : 'group';
        openTermModal({ type, groupId: scope.groupId, deptId: scope.deptId, catId: scope.catId });
    };

    const openUnifiedPartialTerm = (batchId: string) => {
        if (!data?.partialCompleted || data.partialCompleted.length === 0) return;
        const map = new Map<string, { groupId?: string; deptId?: string; catId?: string }>();
        data.partialCompleted.forEach(p => {
            if (getEntryBatchId(p) !== batchId) return;
            const scope = { groupId: p.groupId, deptId: p.deptId, catId: p.catId };
            map.set(partialScopeKey(scope), scope);
        });
        const customScopes = Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([, scope]) => scope);
        if (customScopes.length === 0) return;
        openTermModal({
            type: 'custom',
            customScopes,
            customLabel: 'Contagens Personalizadas (Concluídas)',
            batchId
        });
    };

    const resetPartialHistory = useCallback(async () => {
        if (!data) return;
        alert("Proteção ativa: não é permitido zerar contagens finalizadas nem termos.");
    }, [data]);

    const batchSummaryList = useMemo(() => {
        if (!data?.partialCompleted || data.partialCompleted.length === 0) return [];
        const buckets = new Map<string, { batchId: string; count: number; lastAt: string }>();
        data.partialCompleted.forEach(p => {
            const batchId = getEntryBatchId(p);
            const entry = buckets.get(batchId) || { batchId, count: 0, lastAt: p.completedAt || p.startedAt || new Date(0).toISOString() };
            entry.count += 1;
            const currentTs = new Date(entry.lastAt).getTime();
            const incomingTs = new Date(p.completedAt || p.startedAt || 0).getTime();
            if (incomingTs > currentTs) entry.lastAt = p.completedAt || p.startedAt || entry.lastAt;
            buckets.set(batchId, entry);
        });
        return Array.from(buckets.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    }, [data?.partialCompleted]);

    if (!data || isUpdatingStock) {
        const structureLocked = !!(data && data.groups && data.groups.length > 0);
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
                <div className="max-w-2xl w-full bg-white rounded-[2rem] shadow-2xl overflow-hidden">
                    <div className="bg-indigo-600 p-10 text-center text-white">
                        <h1 className="text-4xl font-black italic tracking-tighter">AuditFlow</h1>
                        <p className="text-indigo-200 text-[10px] uppercase font-bold tracking-widest mt-1 italic">Sistema de Auditoria Master</p>
                    </div>
                    <div className="p-8 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-slate-400">Empresa</label>
                                <select className="w-full bg-slate-50 border-2 rounded-xl px-4 py-3 font-bold border-slate-100" value={selectedEmpresa} onChange={e => setSelectedEmpresa(e.target.value)}>
                                    <option>Drogaria Cidade</option>
                                    {companies.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-slate-400">Selecione a Filial</label>
                                <select className="w-full bg-slate-50 border-2 rounded-xl px-4 py-3 font-bold border-slate-100" value={selectedFilial} onChange={e => setSelectedFilial(e.target.value)}>
                                    <option value="">Selecione...</option>
                                    {FILIAIS.map(f => <option key={f} value={f.toString()}>Filial {f}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-400">Número do Inventário</label>
                                    <div className="w-full bg-slate-100 border-2 rounded-xl px-4 py-3 font-bold border-slate-200 text-slate-500 cursor-not-allowed">
                                        {inventoryNumber || 'Selecione a Filial...'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            {GROUP_UPLOAD_IDS.map((groupId) => {
                                const selectedFile = groupFiles[groupId];
                                const globalFile = globalGroupFiles[groupId];
                                const globalMeta = globalGroupMeta[groupId];
                                const effectiveFile = selectedFile || globalFile;
                                return (
                                    <label
                                        key={`group-upload-${groupId}`}
                                        className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${(!isMaster || structureLocked) ? 'opacity-30 cursor-not-allowed' : ''} ${effectiveFile ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}
                                    >
                                        <input
                                            type="file"
                                            className="hidden"
                                            disabled={!isMaster || structureLocked}
                                            onChange={e => setGroupFile(groupId, e.target.files?.[0] || null)}
                                        />
                                        <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${effectiveFile ? 'text-emerald-500' : 'text-slate-300'}`} />
                                        <p className="text-[8px] font-black uppercase truncate">{selectedFile ? selectedFile.name : effectiveFile ? effectiveFile.name : `Cadastro ${groupId}`}</p>
                                        <p className="text-[8px] font-bold text-slate-500 mt-1">
                                            {selectedFile
                                                ? `Grupo ${groupId} (upload local)`
                                                : globalFile
                                                    ? 'Já carregado em Cadastros Base Globais'
                                                    : `Grupo ${groupId}`}
                                        </p>
                                        {!selectedFile && globalMeta && (
                                            <p className="text-[8px] font-bold text-emerald-700 mt-1">
                                                {formatGlobalTimestamp(globalMeta.updated_at || globalMeta.uploaded_at)}
                                            </p>
                                        )}
                                    </label>
                                );
                            })}

                            <label className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${!isMaster ? 'opacity-30 cursor-not-allowed' : ''} ${fileStock ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                                <input type="file" className="hidden" disabled={!isMaster} onChange={e => setFileStock(e.target.files?.[0] || null)} />
                                <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${fileStock ? 'text-emerald-500' : 'text-slate-300'}`} />
                                <p className="text-[8px] font-black uppercase truncate">{fileStock ? fileStock.name : 'Saldos'}</p>
                            </label>

                            <label className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${(!isMaster || structureLocked) ? 'opacity-30 cursor-not-allowed' : ''} ${effectiveDeptIdsFile ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                                <input type="file" className="hidden" disabled={!isMaster || structureLocked} onChange={e => setFileDeptIds(e.target.files?.[0] || null)} />
                                <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${effectiveDeptIdsFile ? 'text-emerald-500' : 'text-slate-300'}`} />
                                <p className="text-[8px] font-black uppercase truncate">{fileDeptIds ? fileDeptIds.name : effectiveDeptIdsFile ? effectiveDeptIdsFile.name : 'IDs Depto (opcional)'}</p>
                                <p className="text-[8px] font-bold text-slate-500 mt-1">
                                    {fileDeptIds
                                        ? 'Upload local'
                                        : globalDeptIdsFile
                                            ? 'Já carregado em Cadastros Base Globais'
                                            : 'Opcional'}
                                </p>
                                {!fileDeptIds && globalDeptIdsMeta && (
                                    <p className="text-[8px] font-bold text-emerald-700 mt-1">
                                        {formatGlobalTimestamp(globalDeptIdsMeta.updated_at || globalDeptIdsMeta.uploaded_at)}
                                    </p>
                                )}
                            </label>

                            <label className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${(!isMaster || structureLocked) ? 'opacity-30 cursor-not-allowed' : ''} ${effectiveCatIdsFile ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                                <input type="file" className="hidden" disabled={!isMaster || structureLocked} onChange={e => setFileCatIds(e.target.files?.[0] || null)} />
                                <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${effectiveCatIdsFile ? 'text-emerald-500' : 'text-slate-300'}`} />
                                <p className="text-[8px] font-black uppercase truncate">{fileCatIds ? fileCatIds.name : effectiveCatIdsFile ? effectiveCatIdsFile.name : 'IDs Cat (opcional)'}</p>
                                <p className="text-[8px] font-bold text-slate-500 mt-1">
                                    {fileCatIds
                                        ? 'Upload local'
                                        : globalCatIdsFile
                                            ? 'Já carregado em Cadastros Base Globais'
                                            : 'Opcional'}
                                </p>
                                {!fileCatIds && globalCatIdsMeta && (
                                    <p className="text-[8px] font-bold text-emerald-700 mt-1">
                                        {formatGlobalTimestamp(globalCatIdsMeta.updated_at || globalCatIdsMeta.uploaded_at)}
                                    </p>
                                )}
                            </label>
                        </div>
                        {structureLocked && (
                            <p className="text-[10px] font-bold text-amber-600">
                                Estrutura já iniciada nesta auditoria. Após o início, somente o arquivo de SALDOS pode ser alterado.
                            </p>
                        )}
                        <p className="text-[10px] font-bold text-slate-500">
                            Cadastros por grupo carregados em caixas fixas (2000, 3000, 4000, 8000, 10000, 66 e 67). Carregados: <span className="text-slate-700">{effectiveGroupFiles.length}/{GROUP_UPLOAD_IDS.length}</span>.
                            {isLoadingGlobalBases ? ' Verificando bases globais...' : ''}
                        </p>
                        <p className="text-[10px] font-bold text-slate-500">
                            Classificação: cruza <span className="text-slate-700">Estoque B</span> com <span className="text-slate-700">Cadastro K</span> (fallback por código reduzido), e lê <span className="text-slate-700">Departamento S</span> + <span className="text-slate-700">Categoria W</span>.
                        </p>
                        <div className="space-y-3">
                            <button onClick={handleStartAudit} disabled={isProcessing || !isMaster} className={`w-full py-4 rounded-xl text-white font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 ${isProcessing || !isMaster ? 'bg-slate-300 cursor-not-allowed' : 'bg-slate-900 hover:bg-indigo-600'}`}>
                                {isProcessing
                                    ? 'Sincronizando Banco de Dados...'
                                    : isMaster
                                        ? (isUpdatingStock
                                            ? 'Atualizar Somente Saldos'
                                            : 'Iniciar Inventário Master')
                                        : 'Apenas Master pode Iniciar'}
                            </button>
                            <button onClick={handleLoadFromTrier} disabled={isTrierLoading || !isMaster} className={`w-full py-4 rounded-xl text-white font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2 ${isTrierLoading || !isMaster ? 'bg-slate-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
                                <Activity className="w-5 h-5" />
                                {isTrierLoading ? 'Carregando do Trier...' : isMaster ? 'Carregar direto do Trier (tempo real)' : 'Apenas Master pode Carregar'}
                            </button>
                            {trierError && (
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">{trierError}</p>
                                    <button onClick={handleLoadFromTrier} className="text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-emerald-600">
                                        Tentar novamente
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#f1f5f9] pb-32 font-sans rounded-3xl overflow-x-hidden overflow-y-visible shadow-inner">
            <header className="bg-slate-900 text-white sticky top-0 z-[1002] px-8 py-3 shadow-xl flex justify-between items-center border-b border-white/5">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg rotate-2">
                            <ClipboardList className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-xl font-black italic tracking-tighter leading-none">AuditFlow</h1>
                    </div>
                    <div className="h-8 w-px bg-white/10 mx-2"></div>
                    <div className="flex items-center bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-900 px-8 py-2.5 rounded-2xl border-2 border-indigo-400/50 shadow-[0_8px_25px_rgba(79,70,229,0.5)] transform hover:scale-105 transition-transform duration-300">
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black uppercase tracking-[0.3em] text-indigo-300 leading-none mb-1">AUDITANDO AGORA</span>
                            <span className="text-2xl font-black italic tracking-tighter leading-tight text-white drop-shadow-md">FILIAL UNIDADE F{data.filial}</span>
                        </div>
                        <div className="ml-6 flex flex-col items-center">
                            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_#34d399]"></div>
                            <span className="text-[8px] font-bold text-emerald-400 mt-1 uppercase">LIVE</span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={async () => {
                            setIsRefreshing(true);
                            await loadAuditNum();
                            setIsRefreshing(false);
                        }}
                        disabled={isRefreshing}
                        className="relative px-5 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg active:scale-95"
                        style={{
                            background: isRefreshing
                                ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                : 'linear-gradient(135deg, #f97316, #f59e0b)',
                            color: '#fff',
                            boxShadow: isRefreshing ? '0 0 12px #f59e0b88' : '0 0 18px #f9731688, 0 2px 8px #0004',
                            border: '1px solid rgba(251,191,36,0.4)'
                        }}
                        title="Buscar dados atualizados do servidor"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        {isRefreshing ? 'ATUALIZANDO...' : 'ATUALIZAR'}
                    </button>
                    <button onClick={handleExportPDF} className="bg-white/10 hover:bg-white/20 px-5 py-2 rounded-xl text-white font-black text-[9px] uppercase tracking-widest flex items-center gap-2 transition-all border border-white/10">
                        <FileBox className="w-4 h-4" /> PDF ANALÍTICO
                    </button>
                    {Math.round(branchMetrics.progress) === 100 && (
                        <button onClick={handleFinishAudit} disabled={!isMaster} className={`px-5 py-2 rounded-xl text-white font-black text-[9px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg ${!isMaster ? 'bg-slate-400 opacity-50 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-400 animate-pulse'}`}>
                            <CheckSquare className="w-4 h-4" /> ENCERRAR INVENTÁRIO Nº {nextAuditNumber}
                        </button>
                    )}
                    <button onClick={handleSafeExit} className="w-10 h-10 rounded-xl bg-red-600/20 text-red-500 border border-red-500/30 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all shadow-lg active:scale-90" title="Sair e Salvar">
                        <Power className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <div className="sticky top-[76px] z-[1001] bg-white/90 backdrop-blur-xl border-b border-slate-200 shadow-lg px-8 py-5">
                {(partialInfoList.length > 0 || (data?.partialCompleted && data.partialCompleted.length > 0)) && (
                    <div className="max-w-[1400px] mx-auto mb-4">
                        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-2xl shadow-sm">
                            <div className="flex flex-wrap items-center gap-3 justify-between">
                                <Activity className="w-4 h-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Contagem Parcial</span>
                                <div className="ml-auto flex items-center gap-2">
                                    <button
                                        onClick={clearActivePartialsShortcut}
                                        disabled={partialInfoList.length === 0}
                                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${partialInfoList.length === 0
                                            ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                            : 'bg-white text-red-600 border-red-200 hover:bg-red-600 hover:text-white'}`}
                                    >
                                        Desfazer Ativas
                                    </button>
                                    <button
                                        onClick={finalizeActivePartials}
                                        disabled={partialInfoList.length === 0 || !isMaster}
                                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all ${partialInfoList.length === 0 || !isMaster
                                            ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                            : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-600 hover:text-white'}`}
                                        title={!isMaster ? 'Apenas usuário master pode concluir' : undefined}
                                    >
                                        Concluir Ativas
                                    </button>
                                </div>
                            </div>
                            {partialInfoList.length > 0 ? (
                                <div className="mt-3 space-y-3">
                                    {partialInfoList.map((info) => (
                                        <div key={info.key} className="border border-blue-100 bg-white/60 rounded-xl p-3">
                                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                                <span className="text-[10px] font-black text-blue-700/80 uppercase tracking-widest">Início</span>
                                                <span className="text-xs font-semibold">{info.startedAtLabel}</span>
                                            </div>
                                            <div className="grid grid-cols-1 lg:grid-cols-[140px_1fr] gap-2 items-start">
                                                <span className="text-[9px] font-black uppercase tracking-widest text-blue-700/80">Grupo</span>
                                                <span className="text-xs font-semibold">{info.groupLabel || 'N/D'}</span>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-blue-700/80">Departamento</span>
                                                <span className="text-xs font-semibold">{info.deptLabel || 'N/D'}</span>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-blue-700/80">Categorias</span>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {info.catItems.length > 0 ? info.catItems.map((item, idx) => (
                                                        <span key={`cat-${info.key}-${idx}`} className="text-xs font-semibold bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-lg whitespace-nowrap">
                                                            {item}
                                                        </span>
                                                    )) : <span className="text-xs font-semibold">N/D</span>}
                                                </div>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-blue-700/80">Abertos</span>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <span className="text-xs font-black text-blue-700 tabular-nums whitespace-nowrap">
                                                        {info.skus.toLocaleString('pt-BR')} SKUs
                                                    </span>
                                                    <span className="text-xs font-bold text-blue-400">•</span>
                                                    <span className="text-xs font-black text-blue-700 tabular-nums whitespace-nowrap">
                                                        {info.units.toLocaleString('pt-BR')} Produtos
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="border border-blue-100 bg-blue-50/60 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-blue-700/80">Total Aberto</span>
                                        <span className="text-xs font-black text-blue-700 tabular-nums whitespace-nowrap">
                                            {partialTotals.skus.toLocaleString('pt-BR')} SKUs
                                        </span>
                                        <span className="text-xs font-bold text-blue-400">•</span>
                                        <span className="text-xs font-black text-blue-700 tabular-nums whitespace-nowrap">
                                            {partialTotals.units.toLocaleString('pt-BR')} Produtos
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-3 text-xs font-semibold text-blue-700/70">Nenhuma contagem parcial ativa.</div>
                            )}
                            {completedInfoList.length > 0 && (
                                <div className="mt-4 border-t border-blue-100 pt-3">
                                    <div className="flex items-center gap-2 mb-3 justify-between">
                                        <div className="flex items-center gap-2">
                                            <FileSignature className="w-4 h-4 text-blue-600" />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-700/80">Termos</span>
                                        </div>
                                        {isMaster && (
                                            <button
                                                onClick={resetPartialHistory}
                                                className="text-[9px] font-black uppercase tracking-widest text-red-600 bg-white border border-red-200 px-3 py-1 rounded-lg hover:bg-red-600 hover:text-white transition-colors"
                                                title="Zerar contagens concluídas e termos personalizados"
                                            >
                                                Zerar Termos
                                            </button>
                                        )}
                                    </div>
                                    <div className="rounded-2xl border border-blue-100 bg-white/70 p-3">
                                        <div className="text-[9px] font-black uppercase tracking-widest text-blue-700/60 mb-2">Termos Personalizados (Concluídos)</div>
                                        <div className="flex flex-wrap gap-2">
                                            {completedInfoList.map(info => (
                                                <button
                                                    key={`term-${info.key}`}
                                                    onClick={() => openPartialTerm(info.scope)}
                                                    className="text-xs font-semibold bg-white border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-colors whitespace-nowrap"
                                                    title={info.completedAtLabel ? `Concluído em ${info.completedAtLabel}` : undefined}
                                                >
                                                    {info.label}{info.completedAtLabel ? ` • ${info.completedAtLabel}` : ''}
                                                </button>
                                            ))}
                                        </div>
                                        {batchSummaryList.length > 0 && (
                                            <div className="mt-4 pt-3 border-t border-blue-100/70">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-blue-700/60 mb-2">Termos Únicos (Por Lote)</div>
                                                <div className="flex flex-wrap gap-2">
                                                    {batchSummaryList.map(batch => (
                                                        <button
                                                            key={`batch-${batch.batchId}`}
                                                            onClick={() => openUnifiedPartialTerm(batch.batchId)}
                                                            className="text-xs font-semibold bg-white border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-colors whitespace-nowrap"
                                                            title={batch.lastAt ? `Concluído em ${new Date(batch.lastAt).toLocaleString('pt-BR', { hour12: false })}` : undefined}
                                                        >
                                                            Termo único • {batch.count} contagens • {batch.lastAt ? new Date(batch.lastAt).toLocaleString('pt-BR', { hour12: false }) : ''}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-6 gap-6 items-center">
                    <div className="md:col-span-2">
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic leading-none">Conferência Global da Filial</span>
                            <span className="text-2xl font-black text-indigo-600 leading-none">{Math.round(branchMetrics.progress)}%</span>
                        </div>
                        <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden shadow-inner border border-slate-200 p-0.5">
                            <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(79,70,229,0.3)]" style={{ width: `${branchMetrics.progress}%` }}></div>
                        </div>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-100 px-2 min-w-0">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">SKUs Totais</span>
                        <span className="text-2xl font-black text-slate-900 tabular-nums leading-none mt-1">{branchMetrics.skus.toLocaleString()}</span>
                        <span className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-tighter">MIX IMPORTADO</span>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-100 px-2 min-w-0">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Unidades Totais</span>
                        <div className="flex flex-nowrap items-center justify-center gap-2 mt-1 text-center leading-none whitespace-nowrap">
                            <span className="text-[clamp(0.9rem,1.25vw,1.2rem)] font-black text-indigo-700 tabular-nums leading-none whitespace-nowrap">{Math.round(branchMetrics.doneUnits).toLocaleString()}</span>
                            <span className="text-slate-200 text-[clamp(0.7rem,1vw,0.9rem)] leading-none whitespace-nowrap">/</span>
                            <span className="text-[clamp(0.8rem,1.1vw,1.05rem)] font-black text-slate-300 tabular-nums leading-none whitespace-nowrap">{Math.round(branchMetrics.units).toLocaleString()}</span>
                        </div>
                        <span className="text-[8px] font-bold text-indigo-300 uppercase mt-1 tracking-tighter">CONFERIDAS / TOTAIS</span>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-100 px-2 min-w-0">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Valor em Custo</span>
                        <div className="flex flex-nowrap items-center justify-center gap-2 mt-1 text-center leading-none whitespace-nowrap">
                            <span className="text-[clamp(0.88rem,1.2vw,1.15rem)] font-black text-emerald-700 tabular-nums leading-none whitespace-nowrap">R$ {branchMetrics.doneCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="text-slate-200 text-[clamp(0.7rem,1vw,0.9rem)] leading-none whitespace-nowrap">/</span>
                            <span className="text-[clamp(0.8rem,1.05vw,1.05rem)] font-black text-slate-300 tabular-nums leading-none whitespace-nowrap">{branchMetrics.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <span className="text-[8px] font-bold text-emerald-300 uppercase mt-1 tracking-tighter">CONFERIDO / TOTAL</span>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-100 px-2 min-w-0">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Mix Auditado</span>
                        <div className="flex flex-nowrap items-center justify-center gap-2 mt-1 text-center leading-none whitespace-nowrap">
                            <span className="text-[clamp(0.9rem,1.25vw,1.2rem)] font-black text-emerald-600 tabular-nums leading-none whitespace-nowrap">{branchMetrics.doneSkus.toLocaleString()}</span>
                            <span className="text-slate-200 text-[clamp(0.7rem,1vw,0.9rem)] leading-none whitespace-nowrap">/</span>
                            <span className="text-[clamp(0.8rem,1.1vw,1.05rem)] font-black text-slate-300 tabular-nums leading-none whitespace-nowrap">{branchMetrics.pendingSkus.toLocaleString()}</span>
                        </div>
                        <span className="text-[8px] font-bold text-emerald-500 uppercase mt-1 tracking-tighter">CONFERIDOS / PENDENTES</span>
                    </div>

                    <div className="flex flex-col items-center border-l border-indigo-100 bg-indigo-50/50 rounded-2xl py-2 px-4 shadow-sm">
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest italic text-center">Dias Restantes</span>
                        <span className="text-2xl font-black text-indigo-600 tabular-nums leading-none mt-1">{Math.ceil(productivity.etaDays)} <span className="text-[10px] uppercase font-bold text-indigo-400">Dias</span></span>
                        <span className="text-[8px] font-bold text-indigo-300 uppercase mt-1 tracking-tighter">PREVISÃO FINAL</span>
                    </div>
                </div>
            </div>

            <main className="max-w-[1400px] mx-auto px-8 mt-8">
                <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <Breadcrumbs
                        className="mb-0"
                        view={view}
                        onNavigate={l => setView(prev => ({ ...prev, level: l }))}
                        groupName={selectedGroup?.name}
                        deptName={selectedDept?.name}
                    />
                    <div className="relative w-full xl:max-w-[540px]">
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 h-12 shadow-sm">
                            <Search className="w-4 h-4 text-slate-400 shrink-0" />
                            <input
                                ref={auditLookupInputRef}
                                type="text"
                                value={auditLookup}
                                onChange={(e) => {
                                    setAuditLookup(e.target.value);
                                    setAuditLookupOpen(true);
                                }}
                                onFocus={() => setAuditLookupOpen(true)}
                                onBlur={() => setTimeout(() => setAuditLookupOpen(false), 120)}
                                placeholder="Buscar por reduzido, código de barras ou descrição (Ctrl+F)"
                                className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
                            />
                        </div>

                        {auditLookupOpen && normalizedAuditLookup && (
                            <div className="absolute top-[calc(100%+8px)] left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-40 max-h-[360px] overflow-y-auto">
                                {auditLookupResults.length === 0 ? (
                                    <div className="px-4 py-3 text-xs text-slate-500">
                                        Nenhum produto encontrado.
                                    </div>
                                ) : (
                                    auditLookupResults.map((result, index) => (
                                        <button
                                            key={`${result.groupId}-${result.deptId}-${result.catId}-${result.barcode}-${result.reducedCode}-${index}`}
                                            onMouseDown={(event) => {
                                                event.preventDefault();
                                                handleOpenAuditLookupResult(result);
                                            }}
                                            className="w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-indigo-50 transition-colors"
                                        >
                                            <p className="text-xs font-black text-slate-800 uppercase leading-tight">{result.productName}</p>
                                            <p className="text-[11px] text-slate-500 mt-1">
                                                Barras: <span className="font-semibold text-slate-700">{result.barcode || 'N/D'}</span>
                                                {' • '}
                                                Reduzido: <span className="font-semibold text-slate-700">{result.reducedCode || 'N/D'}</span>
                                            </p>
                                            <p className="text-[11px] text-indigo-600 font-semibold mt-1">
                                                Grupo {result.groupId} ({result.groupName}) • Depto {result.deptName} • Cat {result.catName}
                                            </p>
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className={`grid gap-6 ${view.level === 'groups' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                    {view.level === 'groups' && data.groups.map(group => {
                        const m = calcScopeMetrics(group);
                        const totalSkus = Number(m.skus);
                        const doneSkus = Number(m.doneSkus);
                        const isComplete = totalSkus > 0 && doneSkus >= totalSkus;
                        const groupCats = group.departments.flatMap(d => d.categories);
                        const groupHasStarted = groupCats.some(c => normalizeAuditStatus(c.status) !== AuditStatus.TODO);
                        const groupHasInProgress = groupCats.some(c => isInProgressStatus(c.status));
                        const groupAllDone = totalSkus > 0 && doneSkus >= totalSkus;
                        const groupPartialPercent = groupHasInProgress ? getPartialPercentForGroup(group, totalSkus) : 0;
                        const groupProgressValue = groupAllDone ? 100 : groupHasInProgress ? groupPartialPercent : m.progress;
                        return (
                            <div key={group.id} className={`rounded-[2.5rem] p-8 border shadow-sm hover:shadow-xl transition-all group flex flex-col relative overflow-hidden ${groupHasInProgress ? 'bg-blue-50/60 border-blue-200' : 'bg-white border-slate-200'}`}>
                                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 group-hover:bg-indigo-100 transition-colors z-0"></div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-start mb-6">
                                        <span className="text-xl font-black text-indigo-600 bg-indigo-50 px-5 py-2.5 rounded-2xl border border-indigo-100 shadow-sm">ID {group.id}</span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); if (isComplete) openTermModal({ type: 'group', groupId: group.id }); }}
                                                disabled={!isComplete}
                                                className={`px-3 h-10 rounded-xl border flex items-center justify-center gap-1 transition-all shadow-sm text-[10px] font-black uppercase ${isComplete ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-600 hover:text-white' : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'}`}
                                                title={isComplete ? 'Assinar e imprimir termo' : 'Conclua 100% para liberar'}
                                            >
                                                <FileSignature className="w-4 h-4" />
                                                Termo
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); startScopeAudit(group.id); }}
                                                disabled={isComplete}
                                                className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all shadow-sm ${isComplete
                                                    ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                                    : groupHasInProgress
                                                        ? 'bg-blue-600 text-white border-blue-500'
                                                        : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-600 hover:text-white'}`}
                                                title={isComplete ? 'Desmarque a conclusão para iniciar parcial' : (groupHasInProgress ? 'Desativar contagem parcial' : (groupHasStarted ? 'Retomar auditoria parcial' : 'Iniciar auditoria parcial'))}
                                            >
                                                <Activity className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleScopeStatus(group.id); }}
                                                disabled={!isMaster || !groupHasStarted}
                                                className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all shadow-sm ${!isMaster || !groupHasStarted ? 'bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed' : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white'}`}
                                            >
                                                <CheckSquare className="w-5 h-5" />
                                            </button>
                                            <button onClick={() => setView({ level: 'departments', selectedGroupId: group.id })} className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center hover:bg-indigo-600 transition-all shadow-md">
                                                <ChevronRight className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                    <h2 onClick={() => setView({ level: 'departments', selectedGroupId: group.id })} className="text-xl font-black text-slate-900 uppercase italic mb-6 cursor-pointer group-hover:text-indigo-600 flex-1 leading-tight tracking-tight">{group.name}</h2>
                                    <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-50 mb-6">
                                        <div>
                                            <p className="text-[8px] font-black text-slate-400 uppercase italic mb-1">Carga de Mix</p>
                                            <div className="flex justify-between text-xs font-bold items-center">
                                                <span className="text-slate-400">Total: {m.skus}</span>
                                                <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md text-[9px]">{m.doneSkus} Conf.</span>
                                            </div>
                                        </div>
                                        <div className="border-l border-slate-100 pl-6">
                                            <p className="text-[8px] font-black text-slate-400 uppercase italic mb-1">Volume de Unid.</p>
                                            <div className="flex justify-between text-xs font-bold items-center">
                                                <span className="text-slate-400">Total: {Math.round(m.units).toLocaleString()}</span>
                                                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md text-[9px]">{Math.round(m.doneUnits).toLocaleString()} Aud.</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-1 mb-6 pt-4 border-t border-slate-50">
                                        <p className="text-[8px] font-black text-slate-400 uppercase italic">Valor Total (Custo)</p>
                                        <div className="flex justify-between text-sm font-black">
                                            <span className="text-slate-400">R$ {m.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                            <span className="text-emerald-600">R$ {m.doneCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} Aud.</span>
                                        </div>
                                    </div>

                                    {/* Injeção do Dashboard de Excel (Geral) — usa os TOTAIS das excelMetrics */}
                                    {(() => {
                                        const metrics = getScopedMetrics({ type: 'group', groupId: group.id });
                                        if (!metrics) return null;
                                        return <ExcelMetricsDashboard metrics={metrics} auditedBaseCost={m.doneCost} />;
                                    })()}

                                    <div className="mt-6">
                                        <ProgressBar percentage={groupProgressValue} size="md" label={`Progresso do Grupo`} tone={groupAllDone ? 'green' : groupHasInProgress ? 'blue' : 'auto'} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {view.level === 'departments' && selectedGroup?.departments.map(dept => {
                        const m = calcScopeMetrics(dept);
                        const totalSkus = Number(m.skus);
                        const doneSkus = Number(m.doneSkus);
                        const isComplete = totalSkus > 0 && doneSkus >= totalSkus;
                        const deptHasStarted = dept.categories.some(c => normalizeAuditStatus(c.status) !== AuditStatus.TODO);
                        const deptHasInProgress = dept.categories.some(c => isInProgressStatus(c.status));
                        const deptAllDone = totalSkus > 0 && doneSkus >= totalSkus;
                        const deptPartialPercent = deptHasInProgress ? getPartialPercentForDept(selectedGroup!, dept, totalSkus) : 0;
                        const deptProgressValue = deptAllDone ? 100 : deptHasInProgress ? deptPartialPercent : m.progress;
                        return (
                            <div key={dept.id} className={`rounded-[2rem] border shadow-sm hover:shadow-md transition-all p-8 flex items-center gap-10 group ${deptHasInProgress ? 'bg-blue-50/60 border-blue-200' : 'bg-white border-slate-200'}`}>
                                <div className="flex flex-col items-center justify-center bg-slate-50 rounded-[2rem] p-6 min-w-[160px] border border-slate-100 shadow-inner">
                                    <span className="text-[9px] font-black text-slate-400 uppercase mb-2 italic">SISTEMA ID</span>
                                    <span className="text-5xl font-black text-indigo-700 leading-none tracking-tighter">{dept.numericId || '--'}</span>
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start mb-6">
                                        <h2 onClick={() => setView(prev => ({ ...prev, level: 'categories', selectedDeptId: dept.id }))} className="text-3xl font-black text-slate-900 uppercase italic leading-none group-hover:text-indigo-600 cursor-pointer tracking-tighter">{dept.name}</h2>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => { if (isComplete) openTermModal({ type: 'department', groupId: selectedGroup!.id, deptId: dept.id }); }}
                                                disabled={!isComplete}
                                                className={`px-4 py-2 min-w-[76px] rounded-xl text-[10px] font-black uppercase transition-all shadow-sm ${isComplete ? 'bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-600 hover:text-white' : 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed'}`}
                                                title={isComplete ? 'Assinar e imprimir termo' : 'Conclua 100% para liberar'}
                                            >
                                                Termo
                                            </button>
                                            <button
                                                onClick={() => startScopeAudit(selectedGroup?.id, dept.id)}
                                                disabled={deptAllDone}
                                                className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase transition-all shadow-sm ${deptAllDone
                                                    ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                                    : deptHasInProgress
                                                        ? 'bg-blue-600 text-white border-blue-500'
                                                        : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-600 hover:text-white'}`}
                                                title={deptAllDone ? 'Desmarque a conclusão para iniciar parcial' : (deptHasInProgress ? 'Desativar contagem parcial' : (deptHasStarted ? 'Retomar auditoria parcial' : 'Iniciar auditoria parcial'))}
                                            >
                                                {deptHasInProgress ? 'PAUSAR' : 'INICIAR'}
                                            </button>
                                            <button
                                                onClick={() => toggleScopeStatus(selectedGroup?.id, dept.id)}
                                                disabled={!isMaster || !deptHasStarted}
                                                className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase transition-all shadow-sm ${!isMaster || !deptHasStarted ? 'bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed' : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white'}`}
                                            >
                                                Alternar Tudo
                                            </button>
                                            <button onClick={() => setView(prev => ({ ...prev, level: 'categories', selectedDeptId: dept.id }))} className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center hover:bg-indigo-600 transition-all shadow-lg">
                                                <ChevronRight className="w-6 h-6" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-6">
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Mix Total</span><span className="text-lg font-black text-slate-400">{m.skus}</span></div>
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Mix Aud.</span><span className="text-xl font-black text-emerald-600 tabular-nums">{m.doneSkus}</span></div>
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Unid Totais</span><span className="text-lg font-black text-slate-400">{Math.round(m.units).toLocaleString()}</span></div>
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Unid Aud.</span><span className="text-xl font-black text-indigo-600 tabular-nums">{Math.round(m.doneUnits).toLocaleString()}</span></div>
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Custo Total</span><span className="text-lg font-black text-slate-400">R$ {m.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Custo Aud.</span><span className="text-xl font-black text-emerald-600 tabular-nums">R$ {m.doneCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                                    </div>

                                    {(() => {
                                        const metrics = getScopedMetrics({ type: 'department', groupId: selectedGroup!.id, deptId: dept.id });
                                        if (!metrics) return null;
                                        return <ExcelMetricsDashboard metrics={metrics} auditedBaseCost={m.doneCost} />;
                                    })()}

                                    <ProgressBar percentage={deptProgressValue} size="md" label={`Status do Departamento`} tone={deptAllDone ? 'green' : deptHasInProgress ? 'blue' : 'auto'} />
                                </div>
                            </div>
                        );
                    })}

                    {view.level === 'categories' && selectedDept?.categories.map(cat => {
                        const catStatus = normalizeAuditStatus(cat.status);
                        const canFinalize = isMaster && catStatus !== AuditStatus.TODO;
                        const startLabel = catStatus === AuditStatus.IN_PROGRESS ? 'PAUSAR' : 'INICIAR';
                        return (
                            <div key={cat.id} className={`p-6 rounded-[2rem] border-2 flex items-center justify-between gap-8 transition-all hover:shadow-lg group ${catStatus === AuditStatus.DONE ? 'border-emerald-500/20 bg-emerald-50/50' : catStatus === AuditStatus.IN_PROGRESS ? 'border-blue-200 bg-blue-50/40' : 'border-slate-50 bg-white'}`}>
                                <div className="flex-1">
                                    <h3 onClick={() => setView(prev => ({ ...prev, level: 'products', selectedCatId: cat.id }))} className={`font-black text-2xl uppercase italic leading-none cursor-pointer hover:underline transition-all ${catStatus === AuditStatus.DONE ? 'text-emerald-900' : catStatus === AuditStatus.IN_PROGRESS ? 'text-blue-900' : 'text-slate-900'} tracking-tighter`}>{cat.name}</h3>
                                    <div className="flex gap-10 mt-3 items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-slate-400 uppercase italic">SKUs Importados</span>
                                            <span className="text-md font-black text-slate-800 tabular-nums leading-none whitespace-nowrap">{cat.itemsCount} Mix</span>
                                        </div>
                                        <div className="w-px h-6 bg-slate-100"></div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-slate-400 uppercase italic">Estoque Físico</span>
                                            <span className="text-md font-black text-indigo-600 tabular-nums leading-none whitespace-nowrap">{cat.totalQuantity.toLocaleString()} Unid.</span>
                                        </div>
                                        <div className="w-px h-6 bg-slate-100"></div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-slate-400 uppercase italic">Valor em Custo</span>
                                            <span className="text-md font-black text-emerald-600 tabular-nums leading-none whitespace-nowrap">R$ {cat.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                        </div>

                                    </div>
                                    {(() => {
                                        const metrics = getScopedMetrics({ type: 'category', groupId: selectedGroup!.id, deptId: selectedDept!.id, catId: cat.id });
                                        if (!metrics) return null;
                                        return <ExcelMetricsDashboard metrics={metrics} auditedBaseCost={cat.totalCost} />;
                                    })()}
                                </div>
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => { if (catStatus === AuditStatus.DONE) openTermModal({ type: 'category', groupId: selectedGroup!.id, deptId: selectedDept!.id, catId: cat.id }); }}
                                        disabled={catStatus !== AuditStatus.DONE}
                                        className={`px-6 py-4 rounded-xl text-[10px] font-black uppercase transition-all border shadow-sm ${catStatus === AuditStatus.DONE ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:text-white hover:bg-indigo-600' : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'}`}
                                    >
                                        Termo
                                    </button>
                                    <button
                                        onClick={() => startScopeAudit(selectedGroup?.id, selectedDept?.id, cat.id)}
                                        disabled={catStatus === AuditStatus.DONE}
                                        className={`px-6 py-4 rounded-xl text-[10px] font-black uppercase transition-all border shadow-sm ${catStatus === AuditStatus.DONE
                                            ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                            : catStatus === AuditStatus.IN_PROGRESS
                                                ? 'bg-blue-600 text-white border-blue-500'
                                                : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-600 hover:text-white'}`}
                                    >
                                        {startLabel}
                                    </button>
                                    <button onClick={() => setView(prev => ({ ...prev, level: 'products', selectedCatId: cat.id }))} className="px-6 py-4 rounded-xl bg-slate-50 text-slate-400 text-[10px] font-black uppercase hover:text-indigo-600 hover:bg-white transition-all border border-transparent hover:border-indigo-100 shadow-sm">Detalhar</button>
                                    <button
                                        onClick={() => toggleScopeStatus(selectedGroup?.id, selectedDept?.id, cat.id)}
                                        disabled={!canFinalize}
                                        className={`px-10 py-4 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all shadow-md active:scale-95 ${!canFinalize ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : catStatus === AuditStatus.DONE ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-indigo-600'}`}
                                    >
                                        {!canFinalize ? 'INICIE A AUDITORIA' : catStatus === AuditStatus.DONE ? 'CONCLUÍDO' : 'FINALIZAR'}
                                    </button>
                                </div>
                            </div>
                        )
                    })}

                    {view.level === 'products' && selectedCat && (() => {
                        const catStatus = normalizeAuditStatus(selectedCat.status);
                        const canFinalize = isMaster && catStatus !== AuditStatus.TODO;
                        const startLabel = catStatus === AuditStatus.IN_PROGRESS ? 'PAUSAR' : 'INICIAR';
                        return (
                            <div className="bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200">
                                <div className="bg-slate-900 p-10 text-white flex justify-between items-center relative">
                                    <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                                        <Boxes className="w-40 h-40 text-white" />
                                    </div>
                                    <div className="relative z-10">
                                        <h2 className="text-4xl font-black uppercase italic leading-none mb-3 tracking-tighter">{selectedCat.name}</h2>
                                        <div className="flex items-center gap-6">
                                            <span className="text-5xl font-black text-indigo-400 leading-none drop-shadow-sm">ID: {selectedCat.numericId || '--'}</span>
                                            <div className="w-px h-10 bg-white/20"></div>
                                            <div className="flex flex-col">
                                                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest italic">{selectedGroup?.name}</p>
                                                <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest italic">{selectedDept?.name}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-6 items-center relative z-10">
                                        <div className="text-right mr-6 hidden lg:block">
                                            <p className="text-[10px] font-black text-slate-500 uppercase italic mb-1">Resumo de Carga</p>
                                            <p className="text-2xl font-black leading-none">{selectedCat.itemsCount} SKUs <span className="text-indigo-400 mx-2">|</span> {selectedCat.totalQuantity.toLocaleString()} Unid.</p>
                                        </div>
                                        <button
                                            onClick={() => { if (catStatus === AuditStatus.DONE) openTermModal({ type: 'category', groupId: selectedGroup!.id, deptId: selectedDept!.id, catId: selectedCat.id }); }}
                                            disabled={catStatus !== AuditStatus.DONE}
                                            className={`px-6 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl transition-all active:scale-95 border ${catStatus === AuditStatus.DONE ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-600 hover:text-white' : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'}`}
                                        >
                                            Imprimir Termo
                                        </button>
                                        <button
                                            onClick={() => startScopeAudit(selectedGroup?.id, selectedDept?.id, selectedCat.id)}
                                            disabled={catStatus === AuditStatus.DONE}
                                            className={`px-6 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl transition-all active:scale-95 border ${catStatus === AuditStatus.DONE
                                                ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                                : catStatus === AuditStatus.IN_PROGRESS
                                                    ? 'bg-blue-600 text-white border-blue-500'
                                                    : 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-600 hover:text-white'}`}
                                        >
                                            {startLabel}
                                        </button>
                                        <button
                                            onClick={() => toggleScopeStatus(selectedGroup?.id, selectedDept?.id, selectedCat.id)}
                                            disabled={!canFinalize}
                                            className={`px-10 py-5 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] shadow-2xl transition-all active:scale-95 border-b-4 ${!canFinalize ? 'bg-slate-300 border-slate-400 text-slate-500 cursor-not-allowed' : catStatus === AuditStatus.DONE ? 'bg-emerald-600 border-emerald-800' : 'bg-indigo-600 border-indigo-800 hover:bg-indigo-500'}`}
                                        >
                                            {!canFinalize ? 'INICIE A AUDITORIA' : catStatus === AuditStatus.DONE ? 'REABRIR CATEGORIA' : 'CONCLUIR AUDITORIA'}
                                        </button>
                                    </div>
                                </div>
                                <div className="max-h-[650px] overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-md z-20 border-b shadow-sm">
                                            <tr className="border-b border-slate-100">
                                                <th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 tracking-widest italic">Cód. de Barras</th>
                                                <th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 tracking-widest italic">Descrição Analítica do Item</th>
                                                <th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 text-right tracking-widest italic font-mono">Custo Unit</th>
                                                <th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 text-right tracking-widest italic font-mono">Custo Total</th>
                                                <th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 text-right tracking-widest italic">Saldo Importado</th>
                                            </tr>
                                        </thead>
                                        <tbody>{selectedCat.products.map((p, i) => (
                                            <tr key={i} className="border-b border-slate-50 hover:bg-indigo-50/50 transition-colors group text-xs">
                                                <td className="px-12 py-4 text-slate-500 tabular-nums">{p.code}</td>
                                                <td className="px-12 py-4 font-black uppercase italic leading-tight text-slate-800 group-hover:text-indigo-600 transition-colors">{p.name}</td>
                                                <td className="px-12 py-4 text-right tabular-nums text-slate-400 italic">R$ {(p.cost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                <td className="px-12 py-4 text-right tabular-nums font-bold text-slate-600">R$ {((p.cost || 0) * p.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                <td className="px-12 py-4 text-2xl font-black text-right tabular-nums group-hover:scale-105 transition-transform">{p.quantity.toLocaleString()}</td>
                                            </tr>))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )
                    })()}
                </div>
            </main>

            {view.level !== 'groups' && (
                <button onClick={() => setView(prev => ({ ...prev, level: prev.level === 'products' ? 'categories' : prev.level === 'categories' ? 'departments' : 'groups' }))} className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-16 py-6 rounded-full shadow-[0_25px_60px_rgba(0,0,0,0.4)] font-black text-[14px] uppercase tracking-[0.3em] hover:bg-indigo-600 hover:scale-110 active:scale-95 transition-all z-[2002] border-8 border-[#f1f5f9] flex items-center gap-6 group">
                    <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-3" /> Retornar Nível
                </button>
            )}

            {termModal && termForm && termScopeInfo && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[2147483000] flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest flex items-center gap-2">
                                <FileSignature className="w-4 h-4 text-indigo-500" />
                                Termo de Auditoria - {termModal.type === 'custom' ? 'Personalizado' : termModal.type === 'group' ? 'Grupo' : termModal.type === 'department' ? 'Departamento' : 'Categoria'}
                                {(termModal.type === 'group') && termScopeInfo.group.id && ` (ID: ${termScopeInfo.group.id})`}
                                {(termModal.type === 'department') && termScopeInfo.departments[0]?.numericId && ` (ID: ${termScopeInfo.departments[0].numericId})`}
                                {(termModal.type === 'category') && termScopeInfo.categories[0]?.numericId && ` (ID: ${termScopeInfo.categories[0].numericId})`}
                            </h3>
                            <button onClick={closeTermModal} className="text-slate-400 hover:text-red-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-6">
                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs text-slate-600">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Filial</p>
                                        <p className="font-bold">Filial {data?.filial}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Grupo</p>
                                        <p className="font-bold">
                                            {termModal.type === 'custom'
                                                ? `${(termScopeInfo as any).groupLabelText || termScopeInfo.group.name} (personalizado)`
                                                : termScopeInfo.group.name}
                                            {termScopeInfo.group.id && ` (ID: ${termScopeInfo.group.id})`}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Nível</p>
                                        <p className="font-bold capitalize">{termModal.type === 'custom' ? 'personalizado' : termModal.type}</p>
                                    </div>
                                </div>
                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Departamentos</p>
                                        <p className="font-semibold">{termScopeInfo.departments.map(d => `${d.name}${d.numericId ? ` (ID: ${d.numericId})` : ''}`).join(', ') || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Categorias</p>
                                        <p className="font-semibold">{termScopeInfo.categories.map(c => `${c.name}${c.numericId ? ` (ID: ${c.numericId})` : ''}`).join(', ') || '-'}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Nº Inventário</label>
                                    <input
                                        type="text"
                                        value={termForm.inventoryNumber}
                                        onChange={(e) => updateTermForm(prev => ({ ...prev, inventoryNumber: e.target.value }))}
                                        readOnly={!isMaster}
                                        className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                    />
                                </div>
                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</label>
                                    <input
                                        type="text"
                                        value={termForm.date}
                                        onChange={(e) => updateTermForm(prev => ({ ...prev, date: e.target.value }))}
                                        placeholder="DD/MM/AAAA"
                                        readOnly={!isMaster}
                                        className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Assinaturas dos Gestores</h4>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">A assinatura deve ser igual ao documento.</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Gestor 1</p>
                                        <div className="grid grid-cols-1 gap-2 mb-2">
                                            <input
                                                type="text"
                                                value={termForm.managerName2}
                                                onChange={(e) => updateTermForm(prev => ({ ...prev, managerName2: e.target.value }))}
                                                placeholder="Nome do Gestor 1"
                                                readOnly={!isMaster}
                                                className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-xs text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                            />
                                            <input
                                                type="text"
                                                value={termForm.managerCpf2}
                                                onChange={(e) => updateTermForm(prev => ({ ...prev, managerCpf2: e.target.value }))}
                                                placeholder="CPF Gestor 1"
                                                readOnly={!isMaster}
                                                className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-xs text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                            />
                                        </div>
                                        {termForm.managerSignature2 ? (
                                            <div className="relative border border-slate-200 rounded-xl overflow-hidden bg-white h-40 flex items-center justify-center">
                                                <img src={termForm.managerSignature2} alt="Assinatura Gestor" className="max-h-full" />
                                                {isMaster && (
                                                    <button
                                                        type="button"
                                                        onClick={() => updateTermForm(prev => ({ ...prev, managerSignature2: '' }))}
                                                        className="absolute top-2 right-2 bg-red-100 text-red-600 p-1 rounded hover:bg-red-200"
                                                        title="Apagar assinatura"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        ) : isMaster ? (
                                            <SignaturePad onEnd={async (dataUrl) => {
                                                const compressed = await ImageUtils.compressImage(dataUrl, { maxWidth: 600, quality: 0.6 });
                                                updateTermForm(prev => ({ ...prev, managerSignature2: compressed }));
                                            }} />
                                        ) : (
                                            <div className="border border-slate-100 rounded-xl bg-slate-50 h-40 flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase tracking-widest italic">Assinatura Pendente</div>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Gestor 2</p>
                                        <div className="grid grid-cols-1 gap-2 mb-2">
                                            <input
                                                type="text"
                                                value={termForm.managerName}
                                                onChange={(e) => updateTermForm(prev => ({ ...prev, managerName: e.target.value }))}
                                                placeholder="Nome do Gestor 2"
                                                readOnly={!isMaster}
                                                className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-xs text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                            />
                                            <input
                                                type="text"
                                                value={termForm.managerCpf}
                                                onChange={(e) => updateTermForm(prev => ({ ...prev, managerCpf: e.target.value }))}
                                                placeholder="CPF Gestor 2"
                                                readOnly={!isMaster}
                                                className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-xs text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                            />
                                        </div>
                                        {termForm.managerSignature ? (
                                            <div className="relative border border-slate-200 rounded-xl overflow-hidden bg-white h-40 flex items-center justify-center">
                                                <img src={termForm.managerSignature} alt="Assinatura Gestor" className="max-h-full" />
                                                {isMaster && (
                                                    <button
                                                        type="button"
                                                        onClick={() => updateTermForm(prev => ({ ...prev, managerSignature: '' }))}
                                                        className="absolute top-2 right-2 bg-red-100 text-red-600 p-1 rounded hover:bg-red-200"
                                                        title="Apagar assinatura"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        ) : isMaster ? (
                                            <SignaturePad onEnd={async (dataUrl) => {
                                                const compressed = await ImageUtils.compressImage(dataUrl, { maxWidth: 600, quality: 0.6 });
                                                updateTermForm(prev => ({ ...prev, managerSignature: compressed }));
                                            }} />
                                        ) : (
                                            <div className="border border-slate-100 rounded-xl bg-slate-50 h-40 flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase tracking-widest italic">Assinatura Pendente</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Colaboradores</h4>
                                    {isMaster && (
                                        <button
                                            onClick={() => updateTermForm(prev => ({ ...prev, collaborators: [...prev.collaborators, { name: '', cpf: '', signature: '' }] }))}
                                            className="text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-lg hover:bg-indigo-600 hover:text-white transition-all"
                                        >
                                            + Adicionar
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 gap-3">
                                    {termForm.collaborators.map((collab, idx) => {
                                        const collabNumber = idx + 1;
                                        return (
                                            <div key={idx} className="flex gap-3 items-start">
                                                <div className="mt-2 w-7 h-7 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-[10px] font-black flex items-center justify-center shrink-0">
                                                    {collabNumber}
                                                </div>
                                                <div className="flex-1 space-y-3">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <input
                                                            type="text"
                                                            value={collab.name}
                                                            onChange={(e) => updateTermForm(prev => ({
                                                                ...prev,
                                                                collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, name: e.target.value } : c)
                                                            }))}
                                                            placeholder={`Colaborador ${collabNumber}`}
                                                            readOnly={!isMaster}
                                                            className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-xs text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                                        />
                                                        <input
                                                            type="text"
                                                            value={collab.cpf}
                                                            onChange={(e) => updateTermForm(prev => ({
                                                                ...prev,
                                                                collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, cpf: e.target.value } : c)
                                                            }))}
                                                            placeholder={`CPF ${collabNumber}`}
                                                            readOnly={!isMaster}
                                                            className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-xs text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                                        />
                                                    </div>
                                                    {collab.signature ? (
                                                        <div className="relative border border-slate-200 rounded-xl overflow-hidden bg-white h-40 flex items-center justify-center">
                                                            <img src={collab.signature} alt="Assinatura Colaborador" className="max-h-full" />
                                                            {isMaster && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateTermForm(prev => ({
                                                                        ...prev,
                                                                        collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, signature: '' } : c)
                                                                    }))}
                                                                    className="absolute top-2 right-2 bg-red-100 text-red-600 p-1 rounded hover:bg-red-200"
                                                                    title="Apagar assinatura"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ) : isMaster ? (
                                                        <SignaturePad
                                                            label={`Assinatura ${collabNumber}`}
                                                            onEnd={async (dataUrl) => {
                                                                const compressed = await ImageUtils.compressImage(dataUrl, { maxWidth: 600, quality: 0.6 });
                                                                updateTermForm(prev => ({
                                                                    ...prev,
                                                                    collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, signature: compressed } : c)
                                                                }));
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="border border-slate-100 rounded-xl bg-slate-50 h-40 flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase tracking-widest italic">Assinatura Pendente</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">A assinatura deve ser igual ao documento.</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Todos colaboradores da Filial devem assinar.</p>
                            </div>

                            {/* Excel Comparativo do Termo */}
                            <div className="space-y-4 pt-4 border-t border-slate-100">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                        <Upload className="w-4 h-4 text-indigo-500" />
                                        Planilha de Divergências
                                    </h4>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gera resumo financeiro no PDF</span>
                                </div>
                                <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-4 text-center relative hover:bg-slate-50 transition-colors">
                                    <input
                                        type="file"
                                        accept=".xlsx, .xls"
                                        onChange={handleProcessTermComparisonExcel}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        title="Carregar Excel de Divergências"
                                    />
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500">
                                            <Upload className="w-5 h-5" />
                                        </div>
                                        <p className="text-sm font-bold text-slate-700">Carregar Excel de Divergências</p>
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Clique ou arraste o arquivo aqui</p>
                                    </div>
                                </div>

                                {termComparisonMetrics && (
                                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 relative animate-in fade-in slide-in-from-top-2">
                                        {(() => {
                                            const scopeAuditedCost = (termScopeInfo?.products || []).reduce(
                                                (sum: number, p: any) => sum + ((p.quantity || 0) * (p.cost || 0)),
                                                0
                                            );
                                            const representativity = getFinancialRepresentativity(scopeAuditedCost, termComparisonMetrics.diffCost);
                                            return (
                                                <>
                                                    <button
                                                        onClick={removeTermComparisonExcel}
                                                        className={`absolute top-3 right-3 transition-colors ${isMaster ? 'text-indigo-400 hover:text-red-500' : 'text-slate-300 cursor-not-allowed'}`}
                                                        title="Remover planilha"
                                                        disabled={!isMaster}
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                    <h5 className="text-[10px] font-black text-indigo-800 uppercase tracking-widest mb-3">Resumo Identificado</h5>
                                                    <div className="grid grid-cols-2 lg:grid-cols-2 gap-4">
                                                        {/* Row 1: Quantities */}
                                                        <div className="flex justify-between items-center bg-white p-3 rounded border border-slate-100">
                                                            <div>
                                                                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Est. Sist (Qtde)</p>
                                                                <p className="font-bold text-slate-700">{Math.round(termComparisonMetrics.sysQty).toLocaleString('pt-BR')} un.</p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Est. Físico (Qtde)</p>
                                                                <p className="font-bold text-slate-700">{Math.round(termComparisonMetrics.countedQty).toLocaleString('pt-BR')} un.</p>
                                                            </div>
                                                            <div className="text-right pl-4 border-l border-slate-100">
                                                                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Diferença (Qtde)</p>
                                                                <p className={`font-black text-base ${termComparisonMetrics.diffQty < 0 ? 'text-red-500' : termComparisonMetrics.diffQty > 0 ? 'text-green-500' : 'text-slate-600'}`}>
                                                                    {termComparisonMetrics.diffQty > 0 ? '+' : ''}{Math.round(termComparisonMetrics.diffQty).toLocaleString('pt-BR')} un.
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {/* Row 2: Finances */}
                                                        <div className="flex justify-between items-center bg-white p-3 rounded border border-slate-100">
                                                            <div>
                                                                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Custo Sist</p>
                                                                <p className="font-bold text-slate-700">{termComparisonMetrics.sysCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Custo Físico</p>
                                                                <p className="font-bold text-slate-700">{termComparisonMetrics.countedCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                                            </div>
                                                            <div className="text-right pl-4 border-l border-slate-100">
                                                                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Resultado Fin.</p>
                                                                <div className="flex flex-col items-end">
                                                                    <span className={`font-black text-base ${termComparisonMetrics.diffCost < 0 ? 'text-red-600' : termComparisonMetrics.diffCost > 0 ? 'text-green-600' : 'text-slate-600'}`}>
                                                                        {termComparisonMetrics.diffCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                    </span>
                                                                    <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${termComparisonMetrics.diffCost < 0 ? 'bg-red-100 text-red-600' : termComparisonMetrics.diffCost > 0 ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-600'}`}>
                                                                        {termComparisonMetrics.diffCost < 0 ? 'Prejuízo' : termComparisonMetrics.diffCost > 0 ? 'Sobra' : 'Zero'}
                                                                    </span>
                                                                    {representativity !== null && (
                                                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-1">
                                                                            Rep. Auditada: {representativity.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Quadrinho de Resumo por Categoria */}
                                                    {(() => {
                                                        if (!termComparisonMetrics.groupedDifferences || termComparisonMetrics.groupedDifferences.length === 0) return null;

                                                        const groupsMap = new Map();
                                                        termComparisonMetrics.groupedDifferences.forEach((diff: any) => {
                                                            if (!groupsMap.has(diff.groupName)) {
                                                                groupsMap.set(diff.groupName, { name: diff.groupName, diffQty: 0, diffCost: 0, departments: new Map() });
                                                            }
                                                            const g = groupsMap.get(diff.groupName);
                                                            g.diffQty += diff.diffQty;
                                                            g.diffCost += diff.diffCost;

                                                            if (!g.departments.has(diff.deptName)) {
                                                                g.departments.set(diff.deptName, { name: diff.deptName, diffQty: 0, diffCost: 0, categories: [] });
                                                            }
                                                            const d = g.departments.get(diff.deptName);
                                                            d.diffQty += diff.diffQty;
                                                            d.diffCost += diff.diffCost;

                                                            d.categories.push({ name: diff.catName, diffQty: diff.diffQty, diffCost: diff.diffCost });
                                                        });

                                                        const nested = Array.from(groupsMap.values()).map(g => ({
                                                            ...g,
                                                            departments: Array.from(g.departments.values())
                                                                .map((d: any) => ({
                                                                    ...d,
                                                                    categories: d.categories.filter((c: any) =>
                                                                        Math.abs(c.diffQty) > 0.01 || Math.abs(c.diffCost) > 0.01
                                                                    )
                                                                }))
                                                                .filter((d: any) => d.categories.length > 0)
                                                        })).filter(g => g.departments.length > 0);

                                                        if (nested.length === 0) return null;

                                                        return (
                                                            <div className="mt-4 pt-4 border-t border-indigo-100">
                                                                <h6 className="text-[10px] font-black text-indigo-800 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                                                                    <Boxes className="w-3.5 h-3.5" />
                                                                    Resumo de Prejuízo por Categoria
                                                                </h6>
                                                                <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                                                                    {nested.map((group: any, gIdx: number) => (
                                                                        <div key={gIdx} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                                                                            {/* GROUP HEADER */}
                                                                            <div className="p-3 bg-indigo-50/50 border-b border-indigo-100 flex items-center justify-between">
                                                                                <div className="flex items-center gap-3">
                                                                                    <div className="w-8 h-8 rounded-xl bg-white border border-indigo-100 flex items-center justify-center shadow-sm">
                                                                                        <Boxes className="w-4 h-4 text-indigo-600" />
                                                                                    </div>
                                                                                    <div>
                                                                                        <h3 className="text-[11px] font-black text-indigo-900 uppercase italic tracking-wider">{group.name}</h3>
                                                                                        <p className="text-[8px] font-bold text-indigo-400 uppercase tracking-widest mt-0.5">Grupo</p>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="text-right flex items-center gap-3">
                                                                                    <div>
                                                                                        <p className="text-[7px] font-black text-indigo-400 uppercase tracking-widest">Dif. Qtd</p>
                                                                                        <p className={`font-bold text-[10px] ${group.diffQty < 0 ? 'text-red-500' : group.diffQty > 0 ? 'text-green-500' : 'text-slate-500'}`}>{group.diffQty > 0 ? '+' : ''}{Math.round(group.diffQty).toLocaleString('pt-BR')} un.</p>
                                                                                    </div>
                                                                                    <div className="border-l border-indigo-100 pl-3">
                                                                                        <p className="text-[7px] font-black text-indigo-400 uppercase tracking-widest">Finanças</p>
                                                                                        <p className={`font-black text-xs ${group.diffCost < 0 ? 'text-red-600' : group.diffCost > 0 ? 'text-green-600' : 'text-slate-600'}`}>{group.diffCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                                                                    </div>
                                                                                </div>
                                                                            </div>

                                                                            {/* DEPARTMENTS */}
                                                                            <div className="p-3 space-y-3 bg-slate-50/50">
                                                                                {group.departments.map((dept: any, dIdx: number) => (
                                                                                    <div key={dIdx} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                                                                        <div className="p-2.5 border-b border-slate-100 flex items-center justify-between">
                                                                                            <div className="flex items-center gap-2.5">
                                                                                                <div className="w-6 h-6 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center">
                                                                                                    <FileBox className="w-3 h-3 text-slate-500" />
                                                                                                </div>
                                                                                                <div>
                                                                                                    <h4 className="text-[10px] font-black text-indigo-700 uppercase italic tracking-widest">{dept.name}</h4>
                                                                                                    <p className="text-[7px] font-bold text-slate-400 uppercase tracking-widest">Departamento</p>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div className="text-right flex items-center gap-3">
                                                                                                <div>
                                                                                                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Dif. Qtd</p>
                                                                                                    <p className={`font-bold text-[9px] ${dept.diffQty < 0 ? 'text-red-500' : dept.diffQty > 0 ? 'text-green-500' : 'text-slate-500'}`}>{dept.diffQty > 0 ? '+' : ''}{Math.round(dept.diffQty).toLocaleString('pt-BR')} un.</p>
                                                                                                </div>
                                                                                                <div className="border-l border-slate-100 pl-3 w-20">
                                                                                                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">Finanças</p>
                                                                                                    <p className={`font-black text-[11px] ${dept.diffCost < 0 ? 'text-red-600' : dept.diffCost > 0 ? 'text-green-600' : 'text-slate-600'}`}>{dept.diffCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>

                                                                                        {/* CATEGORIES */}
                                                                                        <div className="p-2 bg-[#f8fafc] grid grid-cols-1 gap-1.5">
                                                                                            {dept.categories.map((cat: any, cIdx: number) => {
                                                                                                const catItems = (termComparisonMetrics?.items || []).filter(
                                                                                                    (item: any) =>
                                                                                                        item.catName?.toLowerCase() === cat.name?.toLowerCase() &&
                                                                                                        item.deptName?.toLowerCase() === dept.name?.toLowerCase()
                                                                                                ).sort((a: any, b: any) => a.diffCost - b.diffCost);
                                                                                                const catKey = `${dept.name}|${cat.name}`;
                                                                                                return (
                                                                                                    <div key={cIdx} className="rounded-lg overflow-hidden border border-[#dcfce7]">
                                                                                                        {/* Category header - clickable */}
                                                                                                        <button
                                                                                                            onClick={() => setExpandedCatKeys(prev => {
                                                                                                                const next = new Set(prev);
                                                                                                                if (next.has(catKey)) next.delete(catKey);
                                                                                                                else next.add(catKey);
                                                                                                                return next;
                                                                                                            })}
                                                                                                            className="w-full bg-[#F0FDF4] p-2 flex items-center justify-between transition-colors hover:bg-[#dcfce7] cursor-pointer"
                                                                                                        >
                                                                                                            <div className="flex items-center gap-2">
                                                                                                                <Activity className="w-3 h-3 text-[#059669]" />
                                                                                                                <span className="text-[9px] font-black text-[#065f46] uppercase italic tracking-widest">{cat.name}</span>
                                                                                                                {catItems.length > 0 && (
                                                                                                                    <span className="bg-indigo-100 text-indigo-600 text-[7px] font-black px-1 py-0.5 rounded-full">
                                                                                                                        {catItems.length}
                                                                                                                    </span>
                                                                                                                )}
                                                                                                            </div>
                                                                                                            <div className="flex items-center gap-3 text-right">
                                                                                                                <div className="min-w-[45px]">
                                                                                                                    <span className={`text-[9px] font-bold ${cat.diffQty < 0 ? 'text-red-600' : cat.diffQty > 0 ? 'text-[#16a34a]' : 'text-[#166534]/70'}`}>
                                                                                                                        {cat.diffQty > 0 ? '+' : ''}{Math.round(cat.diffQty).toLocaleString('pt-BR')} un.
                                                                                                                    </span>
                                                                                                                </div>
                                                                                                                <div className="min-w-[65px]">
                                                                                                                    <span className={`text-[10px] font-black ${cat.diffCost < 0 ? 'text-red-600' : cat.diffCost > 0 ? 'text-[#16a34a]' : 'text-[#166534]/80'}`}>
                                                                                                                        {cat.diffCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                                                                    </span>
                                                                                                                </div>
                                                                                                                <ChevronRight className={`w-3 h-3 text-slate-400 transition-transform ${expandedCatKeys.has(catKey) ? 'rotate-90' : ''}`} />
                                                                                                            </div>
                                                                                                        </button>

                                                                                                        {/* Expanded item list */}
                                                                                                        {expandedCatKeys.has(catKey) && catItems.length > 0 && (
                                                                                                            <div className="bg-white border-t border-[#dcfce7]">
                                                                                                                <table className="w-full text-[8px]">
                                                                                                                    <thead>
                                                                                                                        <tr className="bg-slate-50 border-b border-slate-100">
                                                                                                                            <th className="text-left p-1.5 font-black text-slate-500 uppercase tracking-widest">Cód</th>
                                                                                                                            <th className="text-left p-1.5 font-black text-slate-500 uppercase tracking-widest">Descrição</th>
                                                                                                                            <th className="text-right p-1.5 font-black text-slate-500 uppercase">Sist.</th>
                                                                                                                            <th className="text-right p-1.5 font-black text-slate-500 uppercase">Fís.</th>
                                                                                                                            <th className="text-right p-1.5 font-black text-slate-500 uppercase">Dif.</th>
                                                                                                                            <th className="text-right p-1.5 font-black text-slate-500 uppercase">R$</th>
                                                                                                                        </tr>
                                                                                                                    </thead>
                                                                                                                    <tbody>
                                                                                                                        {catItems.map((item: any, iIdx: number) => (
                                                                                                                            <tr key={iIdx} className={`border-b border-slate-50 ${item.diffQty < 0 ? 'bg-red-50/40' : item.diffQty > 0 ? 'bg-green-50/40' : ''}`}>
                                                                                                                                <td className="p-1.5 font-black text-slate-600 tabular-nums">{item.code}</td>
                                                                                                                                <td className="p-1.5 text-slate-700 max-w-[120px] truncate" title={item.description}>{item.description}</td>
                                                                                                                                <td className="p-1.5 text-right text-slate-500 tabular-nums">{Math.round(item.sysQty)}</td>
                                                                                                                                <td className="p-1.5 text-right text-slate-500 tabular-nums">{Math.round(item.countedQty)}</td>
                                                                                                                                <td className={`p-1.5 text-right font-black tabular-nums ${item.diffQty < 0 ? 'text-red-600' : item.diffQty > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                                                                                                                                    {item.diffQty > 0 ? '+' : ''}{Math.round(item.diffQty)}
                                                                                                                                </td>
                                                                                                                                <td className={`p-1.5 text-right font-black tabular-nums ${item.diffCost < 0 ? 'text-red-600' : item.diffCost > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                                                                                                                                    {item.diffCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                                                                                </td>
                                                                                                                            </tr>
                                                                                                                        ))}
                                                                                                                    </tbody>
                                                                                                                </table>
                                                                                                            </div>
                                                                                                        )}
                                                                                                        {expandedCatKeys.has(catKey) && catItems.length === 0 && (
                                                                                                            <div className="p-2 bg-slate-50 text-center text-[8px] text-slate-400 font-bold">
                                                                                                                Nenhum item encontrado nesta categoria
                                                                                                            </div>
                                                                                                        )}
                                                                                                    </div>
                                                                                                );
                                                                                            })}

                                                                                        </div>
                                                                                        {/* Lista de códigos reduzidos para DIVERSOS */}
                                                                                        {dept.name === 'DIVERSOS (SEM DEPARTAMENTO)' && (() => {
                                                                                            const diversosItems = (termComparisonMetrics?.items || []).filter(
                                                                                                (item: any) =>
                                                                                                    item.deptName === 'DIVERSOS (SEM DEPARTAMENTO)' &&
                                                                                                    (Math.abs(item.diffQty) > 0.01 || Math.abs(item.diffCost) > 0.01)
                                                                                            );
                                                                                            if (diversosItems.length === 0) return null;
                                                                                            return (
                                                                                                <div className="p-2 border-t border-amber-100 bg-amber-50">
                                                                                                    <p className="text-[8px] font-black text-amber-700 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                                                                                        <Search className="w-2.5 h-2.5" />
                                                                                                        Itens sem categoria vinculada (Cód. Reduzido)
                                                                                                    </p>
                                                                                                    <div className="flex flex-wrap gap-1">
                                                                                                        {diversosItems.map((item: any, idx: number) => (
                                                                                                            <span key={idx} className="bg-white border border-amber-200 text-amber-800 text-[8px] font-black px-1.5 py-0.5 rounded-md shadow-sm" title={item.description}>
                                                                                                                {item.code}
                                                                                                            </span>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                </div>
                                                                                            );
                                                                                        })()}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                    }
                                                                </div>
                                                            </div>
                                                        )
                                                    })()}
                                                </>
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Produtos no termo: {termScopeInfo.products.length}
                            </span>
                            <button
                                onClick={handlePrintTerm}
                                className="px-6 py-3 rounded-xl bg-slate-900 text-white font-black text-[11px] uppercase tracking-widest hover:bg-indigo-600 transition-all shadow-md"
                            >
                                Imprimir Termo
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )
            }

            <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f8fafc; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 12px; border: 3px solid #f8fafc; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
        </div >
    );
};

export default AuditModule;

