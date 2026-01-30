import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Camera, FileText, CheckSquare, Printer, Clipboard, ClipboardList, Image as ImageIcon, Trash2, Menu, X, ChevronRight, Download, Star, AlertTriangle, CheckCircle, AlertCircle, LayoutDashboard, FileCheck, Settings, LogOut, Users, Palette, Upload, UserPlus, History, RotateCcw, Save, Search, Eye, EyeOff, Phone, User as UserIcon, Ban, Check, Filter, UserX, Undo2, CheckSquare as CheckSquareIcon, Trophy, Frown, PartyPopper, Lock, Loader2, Building2, MapPin, Store, MessageSquare, Send, ThumbsUp, ThumbsDown, Clock, CheckCheck, Lightbulb, MessageSquareQuote, Package } from 'lucide-react';
import { CHECKLISTS as BASE_CHECKLISTS, THEMES, ACCESS_MODULES, ACCESS_LEVELS, INPUT_TYPE_LABELS, generateId } from './constants';
import { ChecklistData, ChecklistImages, InputType, ChecklistSection, ChecklistDefinition, ChecklistItem, ThemeColor, AppConfig, User, ReportHistoryItem, StockConferenceHistoryItem, CompanyArea, AccessLevelId, AccessModule, AccessLevelMeta, UserRole, StockConferenceSummary } from './types';
import PreVencidosManager from './components/preVencidos/PreVencidosManager';
import { clearLocalPVReports, clearLocalPVSession } from './preVencidos/storage';
import SignaturePad from './components/SignaturePad';
import { StockConference } from './components/StockConference';
import { supabase } from './supabaseClient';
import * as SupabaseService from './supabaseService';
import { updateCompany, saveConfig, fetchTickets, createTicket, updateTicketStatus, createCompany, DbTicket } from './supabaseService';
import { Sidebar } from './components/Layout/Sidebar';
import { Header } from './components/Layout/Header';
import { Logo, MFLogo, LogoPrint } from './components/Layout/Logo';


const mergeAccessMatrixWithDefaults = (incoming: Partial<Record<AccessLevelId, Record<string, boolean>>>) => {
    const merged: Record<AccessLevelId, Record<string, boolean>> = {} as any;
    ACCESS_LEVELS.forEach(level => {
        const layer = incoming[level.id] || {};
        merged[level.id] = ACCESS_MODULES.reduce((acc, module) => {
            acc[module.id] = level.id === 'MASTER'
                ? true
                : (typeof layer[module.id] === 'boolean' ? layer[module.id] : false);
            return acc;
        }, {} as Record<string, boolean>);
    });
    return merged;
};

const createInitialAccessMatrix = () => mergeAccessMatrixWithDefaults({});

const sanitizeStockBranch = (branch?: string) => branch?.trim() || 'Filial não informada';
const sanitizeStockArea = (area?: string) => area?.trim() || 'Área não informada';

const canonicalizeFilterLabel = (value: string) => {
    const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    return normalized.replace(/\d+/g, digits => {
        const parsed = Number(digits);
        return Number.isNaN(parsed) ? digits : parsed.toString();
    });
};

const normalizeFilterKey = (value: string) => canonicalizeFilterLabel(value).toLowerCase();

const formatBranchFilterLabel = (value: string) => {
    const canonical = canonicalizeFilterLabel(value);
    return canonical.replace(/\d+/g, digits => digits.padStart(2, '0')).toUpperCase();
};

const sanitizeReportBranch = (report: ReportHistoryItem) => {
    const branchCandidate = report.formData['gerencial']?.filial;
    if (typeof branchCandidate === 'string' && branchCandidate.trim()) return branchCandidate.trim();
    const empresaCandidate = report.formData['gerencial']?.empresa;
    if (typeof empresaCandidate === 'string' && empresaCandidate.trim()) return empresaCandidate.trim();
    if (report.pharmacyName) return report.pharmacyName;
    return 'Filial não informada';
};

const sanitizeReportArea = (report: ReportHistoryItem) => {
    const areaCandidate = report.formData['gerencial']?.area;
    if (typeof areaCandidate === 'string' && areaCandidate.trim()) return areaCandidate.trim();
    return 'Área não informada';
};

const parseJsonValue = <T,>(value: any): T | null => {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }
    return value as T;
};

const formatDurationMs = (ms: number) => {
    if (!ms || ms <= 0) return null;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
};

const formatFullDateTime = (value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const datePart = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return datePart + ' às ' + timePart;
};
const mapStockConferenceReports = (reports: SupabaseService.DbStockConferenceReport[]): StockConferenceHistoryItem[] => {
    return reports.map(rep => {
        const parsedSummary = parseJsonValue<StockConferenceSummary>((rep as any).summary) || rep.summary || { total: 0, matched: 0, divergent: 0, pending: 0, percent: 0 };
        const summary: StockConferenceSummary = parsedSummary || { total: 0, matched: 0, divergent: 0, pending: 0, percent: 0 };
        const branchName = sanitizeStockBranch(rep.branch);
        const areaName = sanitizeStockArea(rep.area);
        const summarySignatures = parseJsonValue<{ pharmacist?: string | null; manager?: string | null }>(summary.signatures) || {};
        const rootSignatures = parseJsonValue<{ pharmacist?: string | null; manager?: string | null }>((rep as any).signatures) || {};
        const startTime = summary.startedAt || summary.started_at || null;
        const endTime = summary.endedAt || summary.ended_at || null;
        const durationMs = summary.durationMs ?? summary.duration_ms ?? null;

        return {
            id: rep.id || `${rep.user_email}_${rep.created_at || Date.now()}`,
            userEmail: rep.user_email,
            userName: rep.user_name,
            branch: branchName,
            area: areaName,
            pharmacist: rep.pharmacist,
            manager: rep.manager,
            total: summary.total,
            matched: summary.matched,
            divergent: summary.divergent,
            pending: summary.pending,
            percent: summary.percent,
            pharmacistSignature: summarySignatures.pharmacist || rootSignatures.pharmacist || null,
            managerSignature: summarySignatures.manager || rootSignatures.manager || null,
            startTime,
            endTime,
            durationMs,
            createdAt: rep.created_at || new Date().toISOString()
        };
    });
};

const mapDbReportToHistoryItem = (r: SupabaseService.DbReport): ReportHistoryItem => {
    const formData = r.form_data || {};
    // Extract info from 'gerencial' checklist if possible
    const gerencial = formData['gerencial'] || {};

    // Also try to find a valid checklist if gerencial is missing/empty
    let fallbackInfo = { empresa: '', area: '', filial: '', gestor: '' };
    if (!gerencial.empresa) {
        // Look in other checklists
        for (const clId of Object.keys(formData)) {
            const data = formData[clId];
            if (data?.empresa) {
                fallbackInfo = {
                    empresa: String(data.empresa),
                    area: String(data.area || ''),
                    filial: String(data.filial || ''),
                    gestor: String(data.gestor || '')
                };
                break;
            }
        }
    }

    return {
        id: r.id || Date.now().toString(),
        userEmail: r.user_email,
        userName: r.user_name,
        date: r.created_at || new Date().toISOString(),
        pharmacyName: r.pharmacy_name,
        score: r.score,
        formData: formData,
        images: r.images || {},
        signatures: r.signatures || {},
        ignoredChecklists: r.ignored_checklists || [],
        empresa_avaliada: String(gerencial.empresa || fallbackInfo.empresa || r.pharmacy_name || '-'),
        area: String(gerencial.area || fallbackInfo.area || '-'),
        filial: String(gerencial.filial || fallbackInfo.filial || '-'),
        gestor: String(gerencial.gestor || fallbackInfo.gestor || '-')
    };
};

type StockReportItem = SupabaseService.DbStockConferenceReport['items'][number];

type EnhancedStockConferenceReport = SupabaseService.DbStockConferenceReport & {
    pharmacistSignature?: string | null;
    managerSignature?: string | null;
};

interface StockConferenceReportViewerProps {
    report: EnhancedStockConferenceReport;
    onClose: () => void;
}

const StockConferenceReportViewer = ({ report, onClose }: StockConferenceReportViewerProps) => {
    const items = report.items || [];
    const parsedSummary = parseJsonValue<StockConferenceSummary>((report as any).summary) || report.summary || { total: items.length, matched: 0, divergent: 0, pending: 0, percent: 0 };
    const summary: StockConferenceSummary = parsedSummary;
    const createdAt = report.created_at ? new Date(report.created_at) : new Date();
    const rootSignatures = parseJsonValue<{ pharmacist?: string | null; manager?: string | null }>((report as any).signatures) || {};
    const signatureData = parseJsonValue<{ pharmacist?: string | null; manager?: string | null }>(summary.signatures) || rootSignatures;
    const pharmacistSignature = report.pharmacistSignature || signatureData.pharmacist || null;
    const managerSignature = report.managerSignature || signatureData.manager || null;
    const startTimestamp = summary.startedAt || summary.started_at || null;
    const endTimestamp = summary.endedAt || summary.ended_at || null;
    let durationMs = summary.durationMs ?? summary.duration_ms ?? null;
    if (
        (durationMs === null || durationMs === undefined) &&
        startTimestamp &&
        endTimestamp
    ) {
        const startDate = new Date(startTimestamp);
        const endDate = new Date(endTimestamp);
        if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
            durationMs = Math.max(0, endDate.getTime() - startDate.getTime());
        }
    }
    const durationLabel = formatDurationMs(durationMs ?? 0) || '0s';
    const startLabel = formatFullDateTime(startTimestamp);
    const endLabel = formatFullDateTime(endTimestamp);
    const recordedAtLabel = formatFullDateTime(createdAt.toISOString());
    const statusLabelText: Record<'divergent' | 'pending' | 'matched', string> = {
        matched: 'Correto',
        divergent: 'Divergente',
        pending: 'Pendente'
    };
    const summaryTotals = {
        total: summary.total ?? items.length,
        matched: summary.matched ?? 0,
        divergent: summary.divergent ?? 0,
        pending: summary.pending ?? 0,
        percent: summary.percent ?? 0
    };

    const statusOrder: Record<'divergent' | 'pending' | 'matched', number> = {
        divergent: 0,
        pending: 1,
        matched: 2
    };

    const sortedItems = [...items].sort((a, b) => {
        const aOrder = statusOrder[(a.status || 'pending') as 'divergent' | 'pending' | 'matched'] ?? 3;
        const bOrder = statusOrder[(b.status || 'pending') as 'divergent' | 'pending' | 'matched'] ?? 3;
        return aOrder - bOrder;
    });

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const exportCSV = () => {
        const headers = 'Codigo Reduzido;Descricao;Estoque Sistema;Contagem;Diferenca;Status\n';
        const rows = sortedItems.map(item => {
            const diff = (item.counted_qty ?? 0) - (item.system_qty ?? 0);
            const statusKey = (item.status || 'pending') as 'divergent' | 'pending' | 'matched';
            const statusLabel = statusLabelText[statusKey] || 'Pendente';
            return `${item.reduced_code};"${item.description || ''}";${item.system_qty ?? 0};${item.counted_qty ?? 0};${diff};${statusLabel}`;
        }).join('\n');

        const blob = new Blob([headers + rows], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const fileName = `conferencia_${(report.branch || 'sem_filial').replace(/\s+/g, '_')}_${createdAt.toISOString().slice(0, 10)}.csv`;
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const exportPDF = () => {
        const jsPDF = (window as any).jspdf?.jsPDF;
        if (!jsPDF) {
            alert('Biblioteca de PDF não carregada.');
            return;
        }

        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text('Relatório de Conferência de Estoque', 14, 20);
        doc.setFontSize(10);

        let headerY = 28;
        const infoLines = [
            'Filial: ' + (report.branch || 'Sem filial'),
            'Área: ' + (report.area || 'Área não informada'),
            'Farmacêutico(a): ' + (report.pharmacist || '-'),
            'Gestor(a): ' + (report.manager || '-'),
            'Responsável: ' + (report.user_name || report.user_email),
            'Início: ' + startLabel,
            'Término: ' + endLabel,
            'Duração: ' + durationLabel,
            'Registrado em: ' + recordedAtLabel
        ];

        infoLines.forEach(line => {
            doc.text(line, 14, headerY);
            headerY += 5;
        });

        const totalsY = headerY + 2;
        doc.text('Total itens: ' + summaryTotals.total, 14, totalsY);
        doc.setTextColor(0, 128, 0);
        doc.text('Corretos: ' + summaryTotals.matched, 14, totalsY + 5);
        doc.setTextColor(200, 0, 0);
        doc.text('Divergentes: ' + summaryTotals.divergent, 70, totalsY + 5);
        doc.setTextColor(255, 165, 0);
        doc.text('Pendentes: ' + summaryTotals.pending, 120, totalsY + 5);
        doc.setTextColor(0, 0, 0);

        const tableColumn = ['Reduzido', 'Descrição', 'Sistema', 'Contagem', 'Diferença', 'Status'];
        const tableRows: any[] = [];
        sortedItems.forEach(item => {
            const diff = (item.counted_qty ?? 0) - (item.system_qty ?? 0);
            const statusKey = (item.status || 'pending') as 'divergent' | 'pending' | 'matched';
            const statusLabel = statusLabelText[statusKey] || 'Pendente';
            tableRows.push([
                item.reduced_code,
                item.description || '',
                (item.system_qty ?? 0).toString(),
                (item.counted_qty ?? 0).toString(),
                diff.toString(),
                statusLabel
            ]);
        });

        (doc as any).autoTable({
            startY: totalsY + 16,
            head: [tableColumn],
            body: tableRows,
            theme: 'grid',
            styles: { fontSize: 8 },
            headStyles: { fillColor: [66, 133, 244] },
            didParseCell: (data: any) => {
                if (data.section === 'body' && data.column.index === 4) {
                    const diffVal = parseFloat(data.row.raw[4]);
                    if (diffVal > 0) {
                        data.cell.styles.textColor = [0, 0, 255];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (diffVal < 0) {
                        data.cell.styles.textColor = [200, 0, 0];
                        data.cell.styles.fontStyle = 'bold';
                    } else {
                        data.cell.styles.textColor = [0, 128, 0];
                    }
                }
            }
        });
        if (pharmacistSignature || managerSignature) {
            const autoTableMeta = (doc as any).lastAutoTable;
            const tableEndY = autoTableMeta?.finalY ?? 0;
            const nextSignatureY = tableEndY > 0 ? tableEndY + 20 : 20;
            const needsPageBreak = nextSignatureY > 250;
            const signatureStartY = needsPageBreak ? 20 : nextSignatureY;

            const renderSignatureSection = (imgData: string, label: string, owner: string, x: number) => {
                doc.addImage(imgData, 'PNG', x, signatureStartY, 60, 30);
                doc.line(x, signatureStartY + 30, x + 60, signatureStartY + 30);
                doc.setFontSize(8);
                doc.text(label, x, signatureStartY + 35);
                doc.text(owner, x, signatureStartY + 40);
            };

            if (needsPageBreak) {
                doc.addPage();
            }

            if (pharmacistSignature) {
                renderSignatureSection(pharmacistSignature, 'Farmacêutico(a) responsável', report.pharmacist || '-', 20);
            }
            if (managerSignature) {
                const offsetX = pharmacistSignature ? 110 : 20;
                renderSignatureSection(managerSignature, 'Gestor(a) responsável', report.manager || '-', offsetX);
            }
        }

        const fileName = `conferencia_${(report.branch || 'sem_filial').replace(/\s+/g, '_')}_${createdAt.toISOString().slice(0, 10)}.pdf`;
        doc.save(fileName);
    };

    const statusStyles: Record<'divergent' | 'pending' | 'matched', { badge: string; border: string }> = {
        divergent: { badge: 'bg-red-50 text-red-600', border: 'border-red-100' },
        pending: { badge: 'bg-yellow-50 text-yellow-700', border: 'border-yellow-100' },
        matched: { badge: 'bg-green-50 text-green-600', border: 'border-green-100' },
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6">
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-10 w-full max-w-[calc(100vw-2rem)] lg:max-w-[calc(100vw-20rem-2rem)] max-h-[90vh] overflow-y-auto rounded-3xl bg-white border border-gray-100 shadow-2xl lg:ml-72">
                <div className="relative border-b border-gray-100">
                    <div className="flex items-start justify-between gap-4 px-6 py-4">
                        <div>
                            <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Conferência de Estoque</p>
                            <h3 className="text-xl font-bold text-gray-900">{report.branch || 'Filial não informada'}</h3>
                            <p className="text-sm text-gray-500">
                                Área: {report.area || 'Área não informada'}
                            </p>
                            <p className="text-sm text-gray-500">
                                {report.pharmacist || 'Farmacêutico não informado'} · {report.manager || 'Gestor não informado'}
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                                Início: {startLabel}
                            </p>
                            <p className="text-xs text-gray-400">
                                Término: {endLabel}
                            </p>
                            <p className="text-xs text-gray-400">
                                Duração total: {durationLabel}
                            </p>
                            <p className="text-xs text-gray-400">
                                Registrado em {recordedAtLabel} por {report.user_name || report.user_email}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 h-10 w-10 rounded-full bg-white text-gray-500 hover:text-gray-800 shadow-md flex items-center justify-center transition"
                        aria-label="Fechar visualização"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="px-6 py-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center">
                            <p className="text-[10px] uppercase tracking-widest text-gray-500">Total</p>
                            <p className="text-3xl font-bold text-gray-900">{summaryTotals.total}</p>
                        </div>
                        <div className="rounded-2xl border border-green-100 bg-green-50 p-4 text-center">
                            <p className="text-[10px] uppercase tracking-widest text-green-600">Corretos</p>
                            <p className="text-3xl font-bold text-green-800">{summaryTotals.matched}</p>
                        </div>
                        <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-center">
                            <p className="text-[10px] uppercase tracking-widest text-red-600">Divergentes</p>
                            <p className="text-3xl font-bold text-red-800">{summaryTotals.divergent}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-yellow-100 bg-yellow-50 p-4 text-center">
                            <p className="text-[10px] uppercase tracking-widest text-yellow-700">Pendentes</p>
                            <p className="text-3xl font-bold text-yellow-800">{summaryTotals.pending}</p>
                        </div>
                        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-center">
                            <p className="text-[10px] uppercase tracking-widest text-blue-600">Progresso</p>
                            <p className="text-3xl font-bold text-blue-800">{Math.round(summaryTotals.percent)}%</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
                        <span className="inline-flex items-center px-3 py-1 border border-gray-200 rounded-full bg-gray-50">Responsável: {report.user_name || report.user_email}</span>
                        <span className="inline-flex items-center px-3 py-1 border border-gray-200 rounded-full bg-gray-50">Farmacêutico: {report.pharmacist || '-'}</span>
                        <span className="inline-flex items-center px-3 py-1 border border-gray-200 rounded-full bg-gray-50">Gestor: {report.manager || '-'}</span>
                    </div>

                    {(pharmacistSignature || managerSignature) && (
                        <div className="grid gap-4 md:grid-cols-2">
                            {pharmacistSignature && (
                                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center space-y-2">
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400">Farmacêutico(a)</p>
                                    <img src={pharmacistSignature} alt="Assinatura Farmacêutico" className="mx-auto h-28 object-contain" />
                                    <p className="text-xs text-gray-500">{report.pharmacist || '-'}</p>
                                </div>
                            )}
                            {managerSignature && (
                                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center space-y-2">
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400">Gestor(a)</p>
                                    <img src={managerSignature} alt="Assinatura Gestor" className="mx-auto h-28 object-contain" />
                                    <p className="text-xs text-gray-500">{report.manager || '-'}</p>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="overflow-x-auto border border-gray-100 rounded-2xl">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-widest">
                                <tr>
                                    <th className="px-4 py-3">Reduzido</th>
                                    <th className="px-4 py-3">Descrição</th>
                                    <th className="px-4 py-3 text-center">Sistema</th>
                                    <th className="px-4 py-3 text-center">Contagem</th>
                                    <th className="px-4 py-3 text-center">Diferença</th>
                                    <th className="px-4 py-3 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-gray-700">
                                {sortedItems.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                                            Nenhum item registrado nessa conferência.
                                        </td>
                                    </tr>
                                )}
                                {sortedItems.map(item => {
                                    const diff = (item.counted_qty ?? 0) - (item.system_qty ?? 0);
                                    const statusKey = (item.status || 'pending') as 'divergent' | 'pending' | 'matched';
                                    const badge = statusStyles[statusKey];
                                    return (
                                        <tr key={`${item.reduced_code}-${item.system_qty}-${item.counted_qty}`}>
                                            <td className="px-4 py-3 font-mono">{item.reduced_code}</td>
                                            <td className="px-4 py-3">{item.description || 'Sem descrição'}</td>
                                            <td className="px-4 py-3 text-center font-mono">{item.system_qty ?? 0}</td>
                                            <td className="px-4 py-3 text-center font-mono">{item.counted_qty ?? 0}</td>
                                            <td className="px-4 py-3 text-center font-mono">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${diff > 0 ? 'text-blue-600' : diff < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                    {diff > 0 ? `+${diff}` : diff}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`text-[10px] font-bold rounded-full px-3 py-1 border ${badge.border} ${badge.badge}`}>
                                                    {statusLabelText[statusKey] || 'Pendente'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3">
                        <button
                            onClick={exportPDF}
                            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg px-5 py-3 text-sm font-bold shadow-lg hover:brightness-110 transition"
                        >
                            <Printer size={16} />
                            <span>Baixar PDF</span>
                        </button>
                        <button
                            onClick={exportCSV}
                            className="flex items-center gap-2 border border-gray-200 rounded-lg px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
                        >
                            <ClipboardList size={16} />
                            <span>Baixar CSV</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- FALLBACK USERS (usado apenas se Supabase falhar) ---
const INITIAL_USERS: User[] = [
    { email: 'asconavietagestor@gmail.com', password: 'marcelo1508', name: 'Marcelo Asconavieta', phone: '99999999999', role: 'MASTER', approved: true, rejected: false },
    { email: 'contato@marcelo.far.br', password: 'marcelo1508', name: 'Contato Marcelo', phone: '99999999999', role: 'MASTER', approved: true, rejected: false },
];

// --- COMPONENTS ---

// Custom Date Input 3D
const DateInput = ({ value, onChange, theme, hasError, disabled }: { value: string, onChange: (val: string) => void, theme: any, hasError?: boolean, disabled?: boolean }) => {
    const [day, setDay] = useState('');
    const [month, setMonth] = useState('');
    const [year, setYear] = useState('');

    useEffect(() => {
        if (value) {
            const parts = value.split('/');
            if (parts.length === 3) {
                setDay(parts[0]);
                setMonth(parts[1]);
                setYear(parts[2]);
            }
        } else {
            setDay('');
            setMonth('');
            setYear('');
        }
    }, [value]);

    const updateDate = (d: string, m: string, y: string) => {
        setDay(d);
        setMonth(m);
        setYear(y);
        if (d && m && y) {
            onChange(`${d}/${m}/${y}`);
        } else {
            onChange('');
        }
    };

    const days = Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0'));
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const years = Array.from({ length: 10 }, (_, i) => (new Date().getFullYear() - 1 + i).toString());

    const selectClass = `appearance-none border ${hasError ? 'border-red-500 bg-red-50 text-red-900' : 'border-gray-200 bg-gray-50 text-gray-900'} rounded-lg p-2.5 focus:ring-2 ${theme.ring} focus:border-transparent outline-none shadow-sm transition-all hover:bg-white cursor-pointer font-medium ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-100' : ''}`;

    return (
        <div className="flex gap-3">
            <div className="flex flex-col w-20">
                <label className="text-[10px] uppercase font-bold text-gray-400 mb-1 tracking-wider">Dia</label>
                <select value={day} onChange={(e) => updateDate(e.target.value, month, year)} className={selectClass} disabled={disabled}>
                    <option value="">--</option>
                    {days.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
            </div>
            <div className="flex flex-col w-24">
                <label className="text-[10px] uppercase font-bold text-gray-400 mb-1 tracking-wider">Mês</label>
                <select value={month} onChange={(e) => updateDate(day, e.target.value, year)} className={selectClass} disabled={disabled}>
                    <option value="">--</option>
                    {months.map((m, i) => <option key={m} value={(i + 1).toString().padStart(2, '0')}>{m}</option>)}
                </select>
            </div>
            <div className="flex flex-col w-24">
                <label className="text-[10px] uppercase font-bold text-gray-400 mb-1 tracking-wider">Ano</label>
                <select value={year} onChange={(e) => updateDate(day, month, e.target.value)} className={selectClass} disabled={disabled}>
                    <option value="">--</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>
        </div>
    );
};

// --- AUTH COMPONENTS ---

const LoginScreen = ({
    onLogin,
    users,
    onRegister,
    companies
}: {
    onLogin: (u: User) => void,
    users: User[],
    onRegister: (u: User) => void,
    companies: any[]
}) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [isForgotPassword, setIsForgotPassword] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [selectedCompanyForRegistration, setSelectedCompanyForRegistration] = useState('');
    const [error, setError] = useState('');
    const [phoneError, setPhoneError] = useState('');
    const [success, setSuccess] = useState('');
    const [shakeButton, setShakeButton] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.replace(/\D/g, '');
        if (val.length <= 11) {
            setPhone(val);
        }
        setPhoneError(''); // clear error while typing
    };

    const handlePhoneBlur = () => {
        if (phone.length > 0 && phone.length !== 11) {
            setPhoneError('Formato inválido. Digite DDD (2) + Número (9). Ex: 11999999999');
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        // --- FORGOT PASSWORD FLOW ---
        if (isForgotPassword) {
            if (!email) {
                setError('Por favor, digite seu e-mail para recuperar a senha.');
                setShakeButton(true);
                setTimeout(() => setShakeButton(false), 500);
                return;
            }
            // Simulate email sending
            setSuccess(`Um link para redefinição de senha foi enviado para ${email}.`);
            setShakeButton(false);
            // Optional: Clear email or reset view after timeout
            setTimeout(() => {
                setIsForgotPassword(false);
                setSuccess('');
                setEmail('');
            }, 4000);
            return;
        }

        // --- REGISTRATION FLOW ---
        if (isRegistering) {
            // Validate Phone Length (11 digits)
            if (phone.length !== 11) {
                setPhoneError('Formato inválido. Digite DDD (2) + Número (9). Ex: 11999999999');
                setShakeButton(true);
                setTimeout(() => setShakeButton(false), 500);
                return;
            }

            // Validate Password Length
            if (password.length < 6) {
                setError('A senha deve ter no mínimo 6 dígitos.');
                setShakeButton(true);
                setTimeout(() => setShakeButton(false), 500);
                return;
            }

            // Validate Passwords Match
            if (password !== confirmPassword) {
                setError('As senhas não coincidem.');
                setShakeButton(true);
                setTimeout(() => setShakeButton(false), 500);
                return;
            }

            if (users.find(u => u.email === email)) {
                setError('E-mail já cadastrado.');
                return;
            }
            onRegister({ email, password, name, phone, role: 'USER', approved: false, rejected: false, company_id: selectedCompanyForRegistration || null });
            setSuccess('Solicitação enviada com sucesso! Seu acesso será avaliado por um mediador.');
            setIsRegistering(false);
            setEmail('');
            setPassword('');
            setConfirmPassword('');
            setName('');
            setPhone('');
            setSelectedCompanyForRegistration('');
        } else {
            // --- LOGIN FLOW ---
            const user = users.find(u => u.email === email && u.password === password);
            if (user) {
                if (user.rejected) {
                    setError('Seu acesso foi recusado ou bloqueado. Contate o administrador.');
                } else if (!user.approved) {
                    setError('Sua conta ainda não foi aprovada pelo Master.');
                } else {
                    onLogin(user);
                }
            } else {
                setError('E-mail ou senha inválidos.');
            }
        }
    };

    const getPasswordInputClass = (val: string) => {
        const mismatch = isRegistering && password && confirmPassword && password !== confirmPassword;
        const match = isRegistering && password && confirmPassword && password === confirmPassword;

        if (mismatch) {
            return "w-full bg-red-50 border border-red-500 rounded-xl p-3.5 text-red-900 focus:ring-2 focus:ring-red-200 focus:border-transparent transition-all outline-none shadow-inner-light placeholder-red-300";
        }
        if (match) {
            return "w-full bg-green-50 border border-green-500 rounded-xl p-3.5 text-gray-900 focus:ring-2 focus:ring-green-200 focus:border-transparent transition-all outline-none shadow-inner-light";
        }
        return "w-full bg-gray-50 border border-gray-200 rounded-xl p-3.5 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#002b5c] focus:border-transparent transition-all outline-none shadow-inner-light";
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Decorative Background */}
            <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-50 z-0"></div>
            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-br from-[#002b5c] to-[#cc0000] transform -skew-y-6 origin-top-left z-0 shadow-2xl"></div>

            <div className="bg-white rounded-3xl shadow-floating w-full max-w-lg overflow-hidden relative z-10 border border-gray-100">
                <div className="pt-10 pb-6 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="w-[6.666rem] h-[6.666rem] filter drop-shadow-md">
                            <MFLogo className="w-full h-full" />
                        </div>
                    </div>
                    <h1 className="text-3xl font-extrabold text-gray-800 uppercase tracking-wide"></h1>
                    <p className="text-gray-500 font-bold tracking-widest text-xs mt-1 uppercase">Gestão & Excelência</p>
                </div>

                <div className="p-8 md:p-12 pt-4">
                    <h2 className="text-xl font-bold text-gray-800 mb-6 text-center border-b border-gray-100 pb-4">
                        {isForgotPassword ? 'Recuperar Senha' : isRegistering ? 'Criar Nova Conta' : 'Acesso ao Sistema'}
                    </h2>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-100 flex items-center shadow-sm">
                            <AlertCircle size={18} className="mr-2" />
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="mb-6 p-4 bg-green-50 text-green-700 text-sm font-medium rounded-xl border border-green-100 flex items-center shadow-sm">
                            <CheckCircle size={18} className="mr-2" />
                            {success}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {isRegistering && (
                            <>
                                <div className="group">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Nome Completo</label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3.5 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#002b5c] focus:border-transparent transition-all outline-none shadow-inner-light"
                                        placeholder="Seu nome"
                                        required={isRegistering}
                                    />
                                </div>
                                <div className="group">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Telefone / WhatsApp</label>
                                    <input
                                        type="tel"
                                        value={phone}
                                        onChange={handlePhoneChange}
                                        onBlur={handlePhoneBlur}
                                        className={`w-full border rounded-xl p-3.5 text-gray-900 focus:bg-white focus:ring-2 focus:border-transparent transition-all outline-none shadow-inner-light ${phoneError ? 'bg-red-50 border-red-500 focus:ring-red-200' : 'bg-gray-50 border-gray-200 focus:ring-[#002b5c]'}`}
                                        placeholder="(00) 00000-0000 (Apenas Números)"
                                        required={isRegistering}
                                    />
                                    {phoneError && <p className="text-red-500 text-xs mt-1 ml-1 font-bold">{phoneError}</p>}
                                </div>
                                <div className="group">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Empresa que Trabalha</label>
                                    <select
                                        value={selectedCompanyForRegistration}
                                        onChange={(e) => setSelectedCompanyForRegistration(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3.5 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#002b5c] focus:border-transparent transition-all outline-none shadow-inner-light"
                                        required={isRegistering}
                                    >
                                        <option value="">-- Selecione a Empresa --</option>
                                        {companies.map((company: any) => (
                                            <option key={company.id} value={company.id}>{company.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}

                        <div className="group">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">E-mail</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3.5 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#002b5c] focus:border-transparent transition-all outline-none shadow-inner-light"
                                placeholder="nome@exemplo.com"
                                required
                            />
                        </div>

                        {/* Show Password fields only if NOT in Forgot Password mode */}
                        {!isForgotPassword && (
                            <div className="group">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Senha</label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className={getPasswordInputClass(password) + " pr-12"}
                                        placeholder="••••••••"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                            </div>
                        )}

                        {isRegistering && (
                            <div className="group">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Confirmar Senha</label>
                                <div className="relative">
                                    <input
                                        type={showConfirmPassword ? "text" : "password"}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className={getPasswordInputClass(confirmPassword) + " pr-12"}
                                        placeholder="••••••••"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                    >
                                        {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Forgot Password Link */}
                        {!isRegistering && !isForgotPassword && (
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => { setIsForgotPassword(true); setError(''); setSuccess(''); }}
                                    className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                                >
                                    Esqueci minha senha
                                </button>
                            </div>
                        )}

                        <button
                            type="submit"
                            className={`w-full bg-gradient-to-r from-[#002b5c] to-[#004a8f] text-white font-bold text-lg py-4 rounded-xl hover:from-[#001a3d] hover:to-[#003366] transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 transform active:scale-95 mt-4 ${shakeButton ? 'animate-shake bg-red-600 from-red-600 to-red-700 hover:from-red-600 hover:to-red-700' : ''}`}
                        >
                            {isForgotPassword ? 'Enviar Link de Redefinição' : isRegistering ? 'Solicitar Cadastro' : 'Entrar no Sistema'}
                        </button>
                    </form>

                    <div className="mt-8 text-center text-sm">
                        {isForgotPassword ? (
                            <button
                                onClick={() => { setIsForgotPassword(false); setError(''); setSuccess(''); }}
                                className="text-gray-500 hover:text-[#002b5c] font-semibold transition-colors flex items-center justify-center gap-2 mx-auto"
                            >
                                <Undo2 size={16} /> Voltar ao Login
                            </button>
                        ) : (
                            <button
                                onClick={() => { setIsRegistering(!isRegistering); setError(''); setSuccess(''); setConfirmPassword(''); setPhone(''); setPhoneError(''); }}
                                className="text-gray-500 hover:text-[#002b5c] font-semibold transition-colors underline decoration-2 decoration-transparent hover:decoration-[#002b5c] underline-offset-4"
                            >
                                {isRegistering ? 'Já tenho conta? Fazer Login' : 'Não tem acesso? Criar conta'}
                            </button>
                        )}
                    </div>
                </div>
                <div className="bg-gray-50 p-4 text-center text-xs text-gray-400 font-medium uppercase tracking-widest border-t border-gray-100">
                    &copy; {new Date().getFullYear()} Marcelo Far
                </div>
            </div>
        </div>
    );
};


// --- MAIN APP ---

const App: React.FC = () => {
    // Migration State
    const [showMigrationPanel, setShowMigrationPanel] = useState(false);
    const [isMigrating, setIsMigrating] = useState(false);
    const [migrationStatus, setMigrationStatus] = useState('');
    // Loading State
    const [isLoadingData, setIsLoadingData] = useState(true);

    // Auth State
    const [users, setUsers] = useState<User[]>(INITIAL_USERS);
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    // Config State
    const [config, setConfig] = useState<AppConfig>({
        pharmacyName: 'Marcelo Far',
        logo: null
    });

    // Companies State
    const [companies, setCompanies] = useState<any[]>([]);

    // App Logic State
    const [checklists, setChecklists] = useState<ChecklistDefinition[]>(BASE_CHECKLISTS);
    const initialChecklistId = BASE_CHECKLISTS[0]?.id || 'gerencial';
    const [activeChecklistId, setActiveChecklistId] = useState<string>(initialChecklistId);
    const [editingChecklistDefinition, setEditingChecklistDefinition] = useState<ChecklistDefinition | null>(null);
    const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
    const [isSavingChecklistDefinition, setIsSavingChecklistDefinition] = useState(false);
    const [formData, setFormData] = useState<Record<string, ChecklistData>>({});
    const [images, setImages] = useState<Record<string, ChecklistImages>>({});
    const [signatures, setSignatures] = useState<Record<string, Record<string, string>>>({});
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [showErrors, setShowErrors] = useState(false);

    const [currentView, setCurrentView] = useState<'checklist' | 'summary' | 'report' | 'settings' | 'history' | 'view_history' | 'support' | 'stock' | 'access' | 'pre'>(() => {
        const saved = localStorage.getItem('APP_CURRENT_VIEW');
        return (saved as any) || 'checklist';
    });

    useEffect(() => {
        if (currentView) {
            localStorage.setItem('APP_CURRENT_VIEW', currentView);
        }
    }, [currentView]);
    const [ignoredChecklists, setIgnoredChecklists] = useState<Set<string>>(new Set());
    const errorBoxRef = useRef<HTMLDivElement>(null);

    // History State
    const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([]);
    const [stockConferenceHistory, setStockConferenceHistory] = useState<StockConferenceHistoryItem[]>([]);
    const [viewHistoryItem, setViewHistoryItem] = useState<ReportHistoryItem | null>(null);
    const [historyFilterUser, setHistoryFilterUser] = useState<string>('all');
    const [isReloadingReports, setIsReloadingReports] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [stockConferenceReportsRaw, setStockConferenceReportsRaw] = useState<SupabaseService.DbStockConferenceReport[]>([]);
    const [viewingStockConferenceReport, setViewingStockConferenceReport] = useState<EnhancedStockConferenceReport | null>(null);
    const [stockBranchFilters, setStockBranchFilters] = useState<string[]>([]);
    const [stockAreaFilter, setStockAreaFilter] = useState<string>('all');

    // Master User Management State
    const [newUserName, setNewUserName] = useState('');
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserPhone, setNewUserPhone] = useState('');
    const [newUserPass, setNewUserPass] = useState('');
    const [newUserConfirmPass, setNewUserConfirmPass] = useState('');
    const [showNewUserPass, setShowNewUserPass] = useState(false);
    const [showNewUserConfirmPass, setShowNewUserConfirmPass] = useState(false);
    const [newUserRole, setNewUserRole] = useState<'MASTER' | 'ADMINISTRATIVO' | 'USER'>('USER');
    const [newUserCompanyId, setNewUserCompanyId] = useState('');
    const [newUserArea, setNewUserArea] = useState('');
    const [newUserFilial, setNewUserFilial] = useState('');
    const [internalShake, setInternalShake] = useState(false);
    const [internalPhoneError, setInternalPhoneError] = useState('');

    // Filters
    const [userFilterRole, setUserFilterRole] = useState<'ALL' | 'MASTER' | 'ADMINISTRATIVO' | 'USER'>('ALL');
    const [userFilterStatus, setUserFilterStatus] = useState<'ALL' | 'ACTIVE' | 'PENDING' | 'BANNED'>('ALL');

    // Change Password State
    const [newPassInput, setNewPassInput] = useState('');
    const [confirmPassInput, setConfirmPassInput] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
    const [saveShake, setSaveShake] = useState(false);
    const [profilePhoneError, setProfilePhoneError] = useState('');
    const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const saveDraftAbortControllerRef = useRef<AbortController | null>(null);

    // User Activity
    const [lastUserActivity, setLastUserActivity] = useState<number>(Date.now());
    const ACTIVITY_TIMEOUT = 5000;

    // Company Editing
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
    const [editCompanyName, setEditCompanyName] = useState('');
    const [editCompanyCnpj, setEditCompanyCnpj] = useState('');
    const [editCompanyPhone, setEditCompanyPhone] = useState('');
    const [editCompanyLogo, setEditCompanyLogo] = useState<string | null>(null);
    const [editCompanyAreas, setEditCompanyAreas] = useState<CompanyArea[]>([]);

    // Company Registration State
    const [newCompanyName, setNewCompanyName] = useState('');
    const [newCompanyCnpj, setNewCompanyCnpj] = useState('');
    const [newCompanyPhone, setNewCompanyPhone] = useState('');
    const [newCompanyLogo, setNewCompanyLogo] = useState<string | null>(null);
    const [newCompanyAreas, setNewCompanyAreas] = useState<CompanyArea[]>([]);
    const [accessMatrix, setAccessMatrix] = useState<Record<AccessLevelId, Record<string, boolean>>>(() => createInitialAccessMatrix());

    const getAccessLevelForRole = (role?: User['role']): AccessLevelId => {
        if (role === 'MASTER') return 'MASTER';
        if (role === 'ADMINISTRATIVO') return 'ADMINISTRATIVO';
        return 'USER';
    };

    const hasModuleAccess = (moduleId: string, levelOverride?: AccessLevelId): boolean => {
        const level = levelOverride || getAccessLevelForRole(currentUser?.role);
        if (level === 'MASTER') return true;
        return !!accessMatrix[level]?.[moduleId];
    };



    // Draft Loading
    const [draftLoaded, setDraftLoaded] = useState(false);
    const [loadedDraftEmail, setLoadedDraftEmail] = useState<string | null>(null);
    const isSavingRef = useRef(false);

    // --- SUPPORT TICKETS STATE ---
    const [tickets, setTickets] = useState<DbTicket[]>([]);
    const [newTicketTitle, setNewTicketTitle] = useState('');
    const [newTicketDesc, setNewTicketDesc] = useState('');
    const [newTicketImages, setNewTicketImages] = useState<string[]>([]);
    const [adminResponseInput, setAdminResponseInput] = useState<Record<string, string>>({});
    const [refreshTickets, setRefreshTickets] = useState(0);


    // --- PERSISTENCE & INIT EFFECTS ---

    const handleToggleAccess = async (levelId: AccessLevelId, moduleId: string) => {
        if (levelId === 'MASTER') return;
        const currentLevel = accessMatrix[levelId];
        if (!currentLevel || !(moduleId in currentLevel)) return;

        const updatedLevel = { ...currentLevel, [moduleId]: !currentLevel[moduleId] };
        setAccessMatrix(prev => ({ ...prev, [levelId]: updatedLevel }));

        try {
            await SupabaseService.upsertAccessMatrix(levelId, updatedLevel);
        } catch (error) {
            console.error('Erro ao salvar permissão de acesso:', error);
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            alert(`Não foi possível salvar a alteração no Supabase (${message}).`);
            setAccessMatrix(prev => ({ ...prev, [levelId]: currentLevel }));
        }
    };

    const handleStockReportsLoaded = (reports: SupabaseService.DbStockConferenceReport[]) => {
        setStockConferenceHistory(mapStockConferenceReports(reports));
        setStockConferenceReportsRaw(reports);
    };

    const refreshStockConferenceReports = async () => {
        const dbStockReports = await SupabaseService.fetchStockConferenceReports();
        handleStockReportsLoaded(dbStockReports);
        return dbStockReports;
    };

    const handleViewStockConferenceReport = async (historyId: string) => {
        let report = stockConferenceReportsRaw.find(r => r.id === historyId);

        // Se o relatório não tiver os itens (que não vêm no summary), buscamos os detalhes
        if (report && (!report.items || report.items.length === 0)) {
            const fullReport = await SupabaseService.fetchStockConferenceReportDetails(historyId);
            if (fullReport) {
                // Atualizar o cache local
                setStockConferenceReportsRaw(prev => prev.map(r => r.id === historyId ? fullReport : r));
                report = fullReport;
            }
        }

        if (!report) {
            alert('Não foi possível localizar o relatório de conferência solicitado.');
            return;
        }

        const historyEntry = stockConferenceHistory.find(item => item.id === historyId);
        const parsedSummary = parseJsonValue<StockConferenceSummary>(report.summary) || report.summary || { total: 0, matched: 0, divergent: 0, pending: 0, percent: 0 };
        const baseSummary: StockConferenceSummary = typeof parsedSummary === 'object' ? parsedSummary : { total: 0, matched: 0, divergent: 0, pending: 0, percent: 0 };
        const summarySignatures = parseJsonValue<{ pharmacist?: string | null; manager?: string | null }>(baseSummary.signatures) || {};
        const rootSignatures = parseJsonValue<{ pharmacist?: string | null; manager?: string | null }>((report as any).signatures) || {};
        const resolvedPharmacistSignature = historyEntry?.pharmacistSignature || summarySignatures.pharmacist || rootSignatures.pharmacist || null;
        const resolvedManagerSignature = historyEntry?.managerSignature || summarySignatures.manager || rootSignatures.manager || null;
        const enrichedSummary = {
            ...baseSummary,
            signatures: {
                pharmacist: resolvedPharmacistSignature,
                manager: resolvedManagerSignature
            }
        };
        setViewingStockConferenceReport({
            ...report,
            summary: enrichedSummary,
            pharmacistSignature: resolvedPharmacistSignature,
            managerSignature: resolvedManagerSignature
        });
    };

    const handleReloadReports = async () => {
        setIsReloadingReports(true);
        try {
            console.log('🔁 Recarregando relatórios...');
            const dbReports = await SupabaseService.fetchReportsSummary(0, 50);
            const formattedReports = dbReports.map(mapDbReportToHistoryItem);
            setReportHistory(formattedReports);
            const dbStockReportsSummary = await SupabaseService.fetchStockConferenceReportsSummary(0, 50);
            handleStockReportsLoaded(dbStockReportsSummary as SupabaseService.DbStockConferenceReport[]);
            console.log('✅ Relatórios recarregados:', formattedReports.length, 'conferências:', dbStockReportsSummary.length);
            alert(`Atualizado! ${formattedReports.length} avaliação(ões) e ${dbStockReportsSummary.length} conferência(s) carregada(s).`);
        } catch (error) {
            console.error('❌ Erro ao recarregar:', error);
            alert('Erro ao recarregar relatórios.');
        } finally {
            setIsReloadingReports(false);
        }
    };

    // MAIN INITIALIZATION - Load all data from Supabase on mount (was cut off, restoring generic structure found in previous views)
    useEffect(() => {
        const initializeData = async () => {
            try {
                setIsLoadingData(true);
                // 1. Load Users
                const dbUsers = await SupabaseService.fetchUsers();
                if (dbUsers.length > 0) {
                    const mappedUsers = dbUsers.map(u => ({ ...u, preferredTheme: u.preferred_theme as ThemeColor | undefined }));
                    setUsers(mappedUsers);
                    localStorage.setItem('APP_USERS', JSON.stringify(mappedUsers));
                } else {
                    const localUsers = localStorage.getItem('APP_USERS');
                    if (localUsers) setUsers(JSON.parse(localUsers));
                }

                // 2. Load Config
                const dbConfig = await SupabaseService.fetchConfig();
                if (dbConfig) {
                    setConfig({ pharmacyName: dbConfig.pharmacy_name, logo: dbConfig.logo });
                    localStorage.setItem('APP_CONFIG', JSON.stringify({ pharmacyName: dbConfig.pharmacy_name, logo: dbConfig.logo }));
                } else {
                    const localConfig = localStorage.getItem('APP_CONFIG');
                    if (localConfig) setConfig(JSON.parse(localConfig));
                }

                // 3. Load Reports Summary (Paginated)
                const dbReportsSummary = await SupabaseService.fetchReportsSummary(0, 30);
                if (dbReportsSummary.length > 0) {
                    setReportHistory(dbReportsSummary.map(mapDbReportToHistoryItem));
                }
                const dbStockReportsSummary = await SupabaseService.fetchStockConferenceReportsSummary(0, 30);
                handleStockReportsLoaded(dbStockReportsSummary as SupabaseService.DbStockConferenceReport[]);

                // 4. Load Companies
                const dbCompanies = await SupabaseService.fetchCompanies();
                if (dbCompanies.length > 0) setCompanies(dbCompanies);

                // 5. Load Access Matrix
                try {
                    const dbMatrix = await SupabaseService.fetchAccessMatrix();
                    if (dbMatrix.length > 0) {
                        const mapped = dbMatrix.reduce((acc, entry) => {
                            acc[entry.level as AccessLevelId] = entry.modules || {};
                            return acc;
                        }, {} as Record<AccessLevelId, Record<string, boolean>>);
                        setAccessMatrix(mergeAccessMatrixWithDefaults(mapped));
                    } else {
                        setAccessMatrix(prev => mergeAccessMatrixWithDefaults(prev));
                    }
                } catch (error) {
                    console.error('Erro ao carregar matriz de acesso:', error);
                }

                // 5. Restore Session
                const savedEmail = localStorage.getItem('APP_CURRENT_EMAIL');
                if (savedEmail) {
                    // logic handled in separate effect, but we can init here? 
                    // Kept consistent with original file structure where separate effect handles it.
                }

                // 6. Load Tickets (Support)
                const dbTickets = await SupabaseService.fetchTickets();
                if (dbTickets.length > 0) setTickets(dbTickets);


            } catch (error) {
                console.error('Error initializing:', error);
                const localUsers = localStorage.getItem('APP_USERS');
                if (localUsers) setUsers(JSON.parse(localUsers));
            } finally {
                setIsLoadingData(false);
            }
        };
        initializeData();
    }, []);

    useEffect(() => {
        const loadChecklistDefinitions = async () => {
            try {
                const dbDefinitions = await SupabaseService.fetchChecklistDefinitions();
                if (!dbDefinitions || dbDefinitions.length === 0) return;
                const serverMap = dbDefinitions.reduce((acc: Record<string, ChecklistDefinition>, entry) => {
                    acc[entry.id] = entry.definition;
                    return acc;
                }, {});
                const ordered = BASE_CHECKLISTS.map(base => serverMap[base.id] || base);
                const extras = dbDefinitions
                    .filter(entry => !BASE_CHECKLISTS.some(base => base.id === entry.id))
                    .map(entry => entry.definition);
                setChecklists([...ordered, ...extras]);
            } catch (error) {
                console.error('Erro ao carregar definições dos checklists:', error);
            }
        };
        loadChecklistDefinitions();
    }, []);

    useEffect(() => {
        if (checklists.length === 0) return;
        if (!checklists.some(cl => cl.id === activeChecklistId)) {
            setActiveChecklistId(checklists[0].id);
        }
    }, [checklists, activeChecklistId]);

    // Save Users to LocalStorage
    useEffect(() => {
        if (!isLoadingData && users.length > 0) {
            localStorage.setItem('APP_USERS', JSON.stringify(users));
        }
    }, [users, isLoadingData]);

    // Load Draft Effect (Restoring as it was missing in view but likely needed)
    useEffect(() => {
        if (currentUser && currentUser.email !== loadedDraftEmail) {
            const loadDraft = async () => {
                const draft = await SupabaseService.fetchDraft(currentUser.email);
                if (draft) {
                    setFormData(draft.form_data || {});
                    setImages(draft.images || {});
                    setSignatures(draft.signatures || {});
                    setIgnoredChecklists(new Set(draft.ignored_checklists || []));
                }
                setDraftLoaded(true);
                setLoadedDraftEmail(currentUser.email);
            };
            loadDraft();
        }
    }, [currentUser, loadedDraftEmail]);

    // Sync currentUser with users array (Restoring the broken fragment)
    useEffect(() => {
        if (currentUser) {
            const freshUser = users.find(u => u.email === currentUser.email);
            if (freshUser) {
                if (freshUser.name !== currentUser.name ||
                    freshUser.phone !== currentUser.phone ||
                    freshUser.photo !== currentUser.photo ||
                    freshUser.preferredTheme !== currentUser.preferredTheme ||
                    freshUser.company_id !== currentUser.company_id ||
                    freshUser.area !== currentUser.area ||
                    freshUser.filial !== currentUser.filial) {
                    setCurrentUser(freshUser);
                }
            }
        }
    }, [users]);

    // Restore logged-in session after users load
    useEffect(() => {
        const savedEmail = localStorage.getItem('APP_CURRENT_EMAIL');
        if (savedEmail && !currentUser) {
            const u = users.find(u => u.email === savedEmail);
            if (u) setCurrentUser(u);
        }
    }, [users]);

    // Sincronização bidirecional - Puxa do Supabase apenas quando usuário está INATIVO
    useEffect(() => {
        if (!currentUser || !draftLoaded) return;

        const syncInterval = setInterval(async () => {
            const timeSinceActivity = Date.now() - lastUserActivity;

            // Pausar sync se usuário está digitando/editando (ativo nos últimos 5 segundos)
            if (timeSinceActivity < ACTIVITY_TIMEOUT) {
                console.log('⏸️ Sync pausado - usuário está editando');
                return;
            }

            if (isSavingRef.current) return; // Não sincronizar durante salvamento

            try {
                const remoteDraft = await SupabaseService.fetchDraft(currentUser.email);

                if (remoteDraft) {
                    // Comparar se há diferenças antes de atualizar (evita re-render desnecessário)
                    const hasChanges =
                        JSON.stringify(remoteDraft.form_data) !== JSON.stringify(formData) ||
                        JSON.stringify(remoteDraft.images) !== JSON.stringify(images) ||
                        JSON.stringify(remoteDraft.signatures) !== JSON.stringify(signatures);

                    if (hasChanges) {
                        console.log('🔄 Sincronizando mudanças remotas (usuário inativo)');
                        setFormData(remoteDraft.form_data || {});
                        setImages(remoteDraft.images || {});
                        setSignatures(remoteDraft.signatures || {});
                        setIgnoredChecklists(new Set(remoteDraft.ignored_checklists || []));
                    }
                }
            } catch (error) {
                console.error('❌ Erro na sincronização:', error);
            }
        }, 3000);

        return () => clearInterval(syncInterval);
    }, [currentUser, draftLoaded, formData, images, signatures, lastUserActivity]);

    // Auto-Save com debounce de 1 segundo (aumentado de 300ms)
    useEffect(() => {
        if (!currentUser || !draftLoaded || isLoadingData) return;

        // Registrar atividade do usuário
        setLastUserActivity(Date.now());

        // Cancel previous save
        if (saveDraftAbortControllerRef.current) {
            saveDraftAbortControllerRef.current.abort();
        }

        const abortController = new AbortController();
        saveDraftAbortControllerRef.current = abortController;

        // Debounce de 1 segundo
        const timeoutId = setTimeout(async () => {
            if (abortController.signal.aborted || isSavingRef.current) return;

            isSavingRef.current = true;
            setSyncStatus('saving');

            const success = await SupabaseService.saveDraft({
                user_email: currentUser.email,
                form_data: formData,
                images: images,
                signatures: signatures,
                ignored_checklists: Array.from(ignoredChecklists)
            });

            if (success) {
                setSyncStatus('saved');
                setTimeout(() => setSyncStatus('idle'), 1000);
            } else {
                setSyncStatus('idle');
            }

            isSavingRef.current = false;
        }, 1000); // Aumentado de 300ms para 1000ms para dar mais tempo ao usuário

        return () => {
            clearTimeout(timeoutId);
            abortController.abort();
        };
    }, [formData, images, signatures, ignoredChecklists, currentUser, isLoadingData, draftLoaded]);

    // Save Config to Supabase AND LocalStorage
    useEffect(() => {
        if (!isLoadingData) {
            localStorage.setItem('APP_CONFIG', JSON.stringify(config));

            // Save to Supabase (async, with debounce)
            const timeoutId = setTimeout(async () => {
                await SupabaseService.saveConfig({
                    pharmacy_name: config.pharmacyName,
                    logo: config.logo
                });
            }, 1000);

            return () => clearTimeout(timeoutId);
        }
    }, [config, isLoadingData]);

    // Scroll to top on initial load
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // Ensure view changes or checklist switches return to top
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [currentView, activeChecklistId]);


    // --- DERIVED STATE ---
    const activeChecklist = checklists.find(c => c.id === activeChecklistId) || checklists[0];
    const currentTheme = THEMES[currentUser?.preferredTheme || 'blue'];

    // Pending users are those NOT approved AND NOT rejected (fresh requests)
    const pendingUsers = users.filter(u => !u.approved && !u.rejected);
    const pendingUsersCount = pendingUsers.length;

    const filteredUsers = users.filter(u => {
        if (userFilterRole !== 'ALL' && u.role !== userFilterRole) return false;
        if (userFilterStatus === 'ACTIVE' && (!u.approved || u.rejected)) return false;
        if (userFilterStatus === 'PENDING' && (u.approved || u.rejected)) return false;
        if (userFilterStatus === 'BANNED' && !u.rejected) return false;
        return true;
    });

    const stockConferenceBranchOptions = useMemo(() => {
        const map = new Map<string, string>();
        stockConferenceHistory.forEach(item => {
            const branchValue = sanitizeStockBranch(item.branch);
            const key = normalizeFilterKey(branchValue);
            if (!map.has(key)) {
                map.set(key, formatBranchFilterLabel(branchValue));
            }
        });
        return Array.from(map.entries())
            .map(([key, label]) => ({ key, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [stockConferenceHistory]);
    const stockConferenceBranchKeys = useMemo(() => stockConferenceBranchOptions.map(option => option.key), [stockConferenceBranchOptions]);

    const stockConferenceAreaOptions = useMemo(() => {
        const map = new Map<string, string>();
        stockConferenceHistory.forEach(item => {
            const label = canonicalizeFilterLabel(sanitizeStockArea(item.area));
            const key = normalizeFilterKey(label);
            if (!map.has(key)) {
                map.set(key, label);
            }
        });
        return Array.from(map.entries())
            .map(([key, label]) => ({ key, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [stockConferenceHistory]);
    const stockConferenceAreaKeys = useMemo(() => stockConferenceAreaOptions.map(option => option.key), [stockConferenceAreaOptions]);

    const filteredStockConferenceHistory = useMemo(() => {
        return stockConferenceHistory.filter(item => {
            const branchKey = normalizeFilterKey(sanitizeStockBranch(item.branch));
            const areaKey = normalizeFilterKey(sanitizeStockArea(item.area));
            const matchesBranch = stockBranchFilters.length === 0 || stockBranchFilters.includes(branchKey);
            const matchesArea = stockAreaFilter === 'all' || areaKey === stockAreaFilter;
            return matchesBranch && matchesArea;
        });
    }, [stockConferenceHistory, stockBranchFilters, stockAreaFilter]);

    useEffect(() => {
        setStockBranchFilters(prev => {
            const filtered = prev.filter(branchKey => stockConferenceBranchKeys.includes(branchKey));
            return filtered.length === prev.length ? prev : filtered;
        });
    }, [stockConferenceBranchKeys]);

    useEffect(() => {
        if (stockAreaFilter !== 'all' && !stockConferenceAreaKeys.includes(stockAreaFilter)) {
            setStockAreaFilter('all');
        }
    }, [stockConferenceAreaKeys, stockAreaFilter]);

    // --- HANDLERS ---

    // Migration Handlers
    const handleBackupDownload = () => {
        SupabaseService.exportLocalStorageBackup();
        alert('✅ Backup baixado com sucesso!');
    };

    const handleMigration = async () => {
        if (!confirm('Deseja migrar todos os dados para o Supabase?\n\nIsso incluirá:\n- Usuários\n- Configurações\n- Relatórios\n- Rascunhos')) {
            return;
        }

        setIsMigrating(true);
        setMigrationStatus('Migrando dados...');

        const results = await SupabaseService.migrateLocalStorageToSupabase();

        if (results) {
            const message = `✅ Migração concluída!\n\nUsuários: ${results.users}\nRelatórios: ${results.reports}\nRascunhos: ${results.drafts}\nConfig: ${results.config ? 'Sim' : 'Não'}`;
            setMigrationStatus(message);
            // Feedback explícito ao usuário
            alert(message);
            setTimeout(() => {
                setShowMigrationPanel(false);
                window.location.reload();
            }, 3000);
        } else {
            const errorMsg = '❌ Erro na migração. Tente novamente.';
            setMigrationStatus(errorMsg);
            alert(errorMsg);
        }

        setIsMigrating(false);
    };

    const handleLogin = (user: User) => {
        // Persist session so F5 doesn't log the user out
        localStorage.setItem('APP_CURRENT_EMAIL', user.email);
        setCurrentUser(user);
    };
    const handleLogout = () => {
        if (currentUser?.email) {
            clearLocalPVSession(currentUser.email);
            clearLocalPVReports(currentUser.email).catch(() => { });
        }
        // Clear persisted session on logout
        localStorage.removeItem('APP_CURRENT_EMAIL');
        localStorage.removeItem('APP_CURRENT_VIEW');
        setCurrentUser(null);
        setFormData({}); // Clear state from memory, relies on draft re-load
        setImages({});
        setSignatures({});
        setCurrentView('checklist');
    };

    const handleRegister = async (newUser: User) => {
        try {
            const created = await SupabaseService.createUser(newUser);
            setUsers(prev => [...prev, created]);
        } catch (error) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            console.error('Erro ao registrar usuário:', error);
            setUsers(prev => [...prev, newUser]);
            alert(`Falha ao enviar cadastro para o Supabase (${message}). O perfil foi salvo localmente.`);
        }
    };

    const updateUserStatus = async (email: string, approved: boolean) => {
        // Update in Supabase
        await SupabaseService.updateUser(email, { approved, rejected: false });
        // Update local state
        setUsers(prev => prev.map(u => u.email === email ? { ...u, approved, rejected: false } : u));
    };

    const handleRejectUser = async (email: string, skipConfirm = true) => {
        // Update in Supabase
        await SupabaseService.updateUser(email, { approved: false, rejected: true });
        // Update local state
        setUsers(prev => prev.map(u => u.email === email ? { ...u, approved: false, rejected: true } : u));
    };

    const handleUpdateUserProfile = async (field: keyof User, value: string | null) => {
        if (!currentUser) return;

        // Custom handling for phone in profile to limit 11 digits
        if (field === 'phone') {
            const val = (value || '').replace(/\D/g, '');
            if (val.length <= 11) {
                setProfilePhoneError(''); // clear error on type
                setUsers(prevUsers => prevUsers.map(u => u.email === currentUser.email ? { ...u, phone: val } : u));
                // Update in Supabase
                await SupabaseService.updateUser(currentUser.email, { phone: val });
            }
        } else {
            setUsers(prevUsers => prevUsers.map(u => u.email === currentUser.email ? { ...u, [field]: value } : u));
            // Update in Supabase
            await SupabaseService.updateUser(currentUser.email, { [field]: value } as any);
        }
    };

    const handleProfilePhoneBlur = () => {
        if (currentUser?.phone && currentUser.phone.length !== 11) {
            setProfilePhoneError('Formato inválido. Digite DDD (2) + Número (9).');
        }
    };


    const handleUserPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const photo = reader.result as string;
                // Update state
                setUsers(prevUsers => prevUsers.map(u => u.email === currentUser?.email ? { ...u, photo } : u));
                // Update in Supabase
                if (currentUser) {
                    await SupabaseService.updateUser(currentUser.email, { photo });
                }
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleUpdateUserTheme = async (theme: ThemeColor) => {
        if (!currentUser) return;

        // Update user's preferred theme
        setUsers(prevUsers => prevUsers.map(u =>
            u.email === currentUser.email ? { ...u, preferredTheme: theme } : u
        ));

        // Save to Supabase (map camelCase to snake_case)
        await SupabaseService.updateUser(currentUser.email, { preferred_theme: theme } as any);
    }; const handleSaveProfileAndSecurity = async () => {
        if (!currentUser) return;

        // Validate Phone
        if (currentUser.phone) {
            const cleanPhone = currentUser.phone.replace(/\D/g, '');
            if (cleanPhone.length !== 11) {
                setSaveShake(true);
                setProfilePhoneError('Formato inválido. Digite DDD (2) + Número (9).');
                setTimeout(() => setSaveShake(false), 500);
                alert("O telefone deve conter exatamente 11 dígitos (DDD + Número).");
                return;
            }
        }

        // Validate Password Logic if attempted
        if (newPassInput || confirmPassInput) {
            if (newPassInput !== confirmPassInput) {
                setSaveShake(true);
                setTimeout(() => setSaveShake(false), 500);
                alert("Erro: As senhas não coincidem. Verifique os campos em vermelho.");
                return;
            }
            if (newPassInput.length < 6) {
                setSaveShake(true);
                setTimeout(() => setSaveShake(false), 500);
                alert("Erro: A senha deve ter pelo menos 6 caracteres.");
                return;
            }
            // Update Password in local state
            setUsers(prevUsers => prevUsers.map(u => u.email === currentUser.email ? { ...u, password: newPassInput } : u));
            // Update Password in Supabase
            await SupabaseService.updateUser(currentUser.email, { password: newPassInput });
        }

        // Clear password fields
        setNewPassInput('');
        setConfirmPassInput('');

        alert("Dados e configurações atualizados com sucesso!");
    };

    // Internal User Creation Handlers
    const handleInternalPhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.replace(/\D/g, '');
        if (val.length <= 11) {
            setNewUserPhone(val);
        }
        setInternalPhoneError('');
    };

    const handleInternalPhoneBlur = () => {
        if (newUserPhone.length > 0 && newUserPhone.length !== 11) {
            setInternalPhoneError('Formato inválido. Digite DDD (2) + Número (9).');
        }
    };


    const handleCreateUserInternal = async () => {
        if (!newUserName || !newUserEmail || !newUserPass || !newUserPhone || !newUserConfirmPass) {
            alert("Preencha todos os campos.");
            return;
        }

        // Validate Phone
        const cleanPhone = newUserPhone.replace(/\D/g, '');
        if (cleanPhone.length !== 11) {
            setInternalShake(true);
            setInternalPhoneError('Formato inválido. Digite DDD (2) + Número (9).');
            setTimeout(() => setInternalShake(false), 500);
            alert("⚠️ O telefone deve conter exatamente 11 dígitos (DDD + Número).");
            return;
        }

        // Validate Passwords
        if (newUserPass !== newUserConfirmPass) {
            setInternalShake(true);
            setTimeout(() => setInternalShake(false), 500);
            alert("As senhas não coincidem.");
            return;
        }

        if (newUserPass.length < 6) {
            setInternalShake(true);
            setTimeout(() => setInternalShake(false), 500);
            alert("A senha deve ter pelo menos 6 caracteres.");
            return;
        }

        if (users.find(u => u.email === newUserEmail)) {
            alert("Email já cadastrado.");
            return;
        }

        const newUser: User = {
            name: newUserName,
            email: newUserEmail,
            phone: newUserPhone,
            password: newUserPass,
            role: newUserRole,
            approved: true, // Internal creation is auto-approved
            rejected: false,
            company_id: newUserCompanyId || null,
            area: newUserArea || null,
            filial: newUserFilial || null
        };

        try {
            const created = await SupabaseService.createUser(newUser);
            setUsers(prev => [...prev, created]);
        } catch (error) {
            console.error('Erro ao criar usuário interno:', error);
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            alert(`Não foi possível criar o usuário Administrativo no Supabase (${message}).`);
            return;
        }

        setNewUserName('');
        setNewUserEmail('');
        setNewUserPhone('');
        setNewUserPass('');
        setNewUserConfirmPass('');
        setInternalPhoneError('');
        setNewUserRole('USER');
        setNewUserCompanyId('');
        setNewUserArea('');
        setNewUserFilial('');
        alert("Usuário criado com sucesso!");
    };

    const handleDeleteHistoryItem = async (itemId: string) => {
        if (confirm("Atenção: Esta ação é irreversível. Tem certeza que deseja excluir permanentemente este relatório?")) {
            // Delete from Supabase
            await SupabaseService.deleteReport(itemId);
            // Delete from local state
            setReportHistory(prev => prev.filter(item => item.id !== itemId));
            // If viewing deleted item, go back to list
            if (viewHistoryItem?.id === itemId) {
                setCurrentView('history');
                setViewHistoryItem(null);
            }
        }
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setConfig(prev => ({ ...prev, logo: reader.result as string }));
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleInputChange = (itemId: string, value: string | boolean | number) => {
        // Determine which checklist we are editing (Draft or History View - although history is read only)
        if (currentView === 'view_history') return;

        // --- BASIC INFO SYNC LOGIC ---
        // If updating a global field (Name, Filial, Manager, Date), sync it across all checklists
        // IDs must match those in INFO_BASICA_SECTION (empresa, nome_coordenador, filial, area, gestor, data_aplicacao)
        const isGlobalField = ['empresa', 'nome_coordenador', 'filial', 'area', 'gestor', 'data_aplicacao'].includes(itemId);

        setFormData(prev => {
            const newData = { ...prev };

            // Update the current checklist data
            newData[activeChecklistId] = {
                ...(newData[activeChecklistId] || {}),
                [itemId]: value
            };

            // If this is a global field, update it in ALL other checklists as well
            if (isGlobalField) {
                checklists.forEach(cl => {
                    if (cl.id !== activeChecklistId) {
                        newData[cl.id] = {
                            ...(newData[cl.id] || {}),
                            [itemId]: value
                        };
                    }
                });
            }

            // Salvar imediatamente no localStorage
            if (currentUser) {
                const allDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
                allDrafts[currentUser.email] = {
                    formData: newData,
                    images: images,
                    signatures: signatures,
                    ignoredChecklists: Array.from(ignoredChecklists)
                };
                localStorage.setItem('APP_DRAFTS', JSON.stringify(allDrafts));
            }

            return newData;
        });
    };

    const openChecklistEditor = (checklistId: string) => {
        const base = checklists.find(c => c.id === checklistId);
        if (!base) return;
        setEditingChecklistId(checklistId);
        setEditingChecklistDefinition(JSON.parse(JSON.stringify(base)));
    };

    const closeChecklistEditor = () => {
        setEditingChecklistDefinition(null);
        setEditingChecklistId(null);
    };

    const updateEditingDefinition = (updater: (draft: ChecklistDefinition) => ChecklistDefinition) => {
        setEditingChecklistDefinition(prev => {
            if (!prev) return prev;
            const draft = JSON.parse(JSON.stringify(prev)) as ChecklistDefinition;
            return updater(draft);
        });
    };

    const handleSectionTitleChange = (sectionId: string, title: string) => {
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: draft.sections.map(section =>
                section.id === sectionId ? { ...section, title } : section
            )
        }));
    };

    const handleRemoveSection = (sectionId: string) => {
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: draft.sections.filter(section => section.id !== sectionId)
        }));
    };

    const handleAddSection = () => {
        const newSection: ChecklistSection = {
            id: generateId('section'),
            title: 'Nova Seção',
            items: []
        };
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: [...draft.sections, newSection]
        }));
    };

    const handleAddQuestion = (sectionId: string) => {
        const newItem: ChecklistItem = {
            id: generateId('item'),
            text: 'Nova pergunta',
            type: InputType.TEXT,
            required: true
        };
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: draft.sections.map(section =>
                section.id === sectionId ? { ...section, items: [...section.items, newItem] } : section
            )
        }));
    };

    const handleRemoveQuestion = (sectionId: string, itemId: string) => {
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: draft.sections.map(section =>
                section.id === sectionId
                    ? { ...section, items: section.items.filter(item => item.id !== itemId) }
                    : section
            )
        }));
    };

    const handleItemTextChange = (sectionId: string, itemId: string, text: string) => {
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: draft.sections.map(section =>
                section.id === sectionId
                    ? {
                        ...section,
                        items: section.items.map(item =>
                            item.id === itemId ? { ...item, text } : item
                        )
                    }
                    : section
            )
        }));
    };

    const handleItemTypeChange = (sectionId: string, itemId: string, type: InputType) => {
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: draft.sections.map(section =>
                section.id === sectionId
                    ? {
                        ...section,
                        items: section.items.map(item =>
                            item.id === itemId ? { ...item, type } : item
                        )
                    }
                    : section
            )
        }));
    };

    const handleItemRequiredToggle = (sectionId: string, itemId: string, required: boolean) => {
        updateEditingDefinition((draft) => ({
            ...draft,
            sections: draft.sections.map(section =>
                section.id === sectionId
                    ? {
                        ...section,
                        items: section.items.map(item =>
                            item.id === itemId ? { ...item, required } : item
                        )
                    }
                    : section
            )
        }));
    };

    const handleSaveChecklistDefinition = async () => {
        if (!editingChecklistDefinition || !editingChecklistId) return;
        setIsSavingChecklistDefinition(true);
        try {
            await SupabaseService.upsertChecklistDefinition(editingChecklistDefinition);
            setChecklists(prev => {
                const exists = prev.some(entry => entry.id === editingChecklistDefinition.id);
                const updated = prev.map(entry =>
                    entry.id === editingChecklistDefinition.id ? editingChecklistDefinition : entry
                );
                if (!exists) {
                    updated.push(editingChecklistDefinition);
                }
                return updated;
            });
            alert('Checklist atualizado com sucesso.');
            closeChecklistEditor();
        } catch (error) {
            console.error('Erro ao salvar checklist:', error);
            alert('Não foi possível salvar as alterações do checklist.');
        } finally {
            setIsSavingChecklistDefinition(false);
        }
    };

    const handleImageUpload = (sectionId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            // Verificar limite de 2 imagens por seção
            const currentImages = images[activeChecklistId]?.[sectionId] || [];
            if (currentImages.length >= 2) {
                alert('⚠️ Máximo de 2 imagens por seção atingido. Remova uma imagem antes de adicionar outra.');
                e.target.value = '';
                return;
            }

            // Validar tipo de arquivo
            if (!file.type.startsWith('image/')) {
                alert('⚠️ Por favor, selecione apenas arquivos de imagem.');
                e.target.value = '';
                return;
            }

            // Suportar até 15MB por imagem
            if (file.size > 15 * 1024 * 1024) {
                alert('⚠️ Imagem muito grande (máximo 15MB). Tente uma foto menor ou com menos zoom.');
                e.target.value = '';
                return;
            }

            try {
                const reader = new FileReader();

                reader.onerror = () => {
                    alert('❌ Erro ao carregar a imagem. Tente novamente.');
                    e.target.value = '';
                };

                reader.onloadend = () => {
                    try {
                        const img = new Image();

                        img.onerror = () => {
                            alert('❌ Erro ao processar a imagem. Tente outro formato (JPG/PNG).');
                            e.target.value = '';
                        };

                        img.onload = () => {
                            try {
                                const canvas = document.createElement('canvas');
                                let width = img.width;
                                let height = img.height;

                                // Redimensionar para máximo 1200px (alta qualidade, 800KB-1.5MB target)
                                const maxDimension = 1200;
                                if (width > height && width > maxDimension) {
                                    height = (height * maxDimension) / width;
                                    width = maxDimension;
                                } else if (height > maxDimension) {
                                    width = (width * maxDimension) / height;
                                    height = maxDimension;
                                }

                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext('2d');

                                if (!ctx) {
                                    alert('❌ Erro ao processar imagem. Tente novamente.');
                                    e.target.value = '';
                                    return;
                                }

                                ctx.drawImage(img, 0, 0, width, height);

                                // Compressão balanceada: começar com 80% de qualidade e reduzir até 800KB
                                let quality = 0.8;
                                let compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                                const targetSize = 800 * 1024; // 800KB target

                                while (compressedBase64.length > targetSize && quality > 0.3) {
                                    quality -= 0.05;
                                    compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                                }

                                // Limite absoluto de 1.5MB após compressão
                                if (compressedBase64.length > 1536 * 1024) {
                                    alert('⚠️ Não foi possível comprimir a imagem o suficiente.\n\nDicas:\n• Tire a foto com menos zoom\n• Aproxime-se do objeto\n• Use menor resolução na câmera');
                                    e.target.value = '';
                                    return;
                                }

                                setImages(prev => {
                                    const currentListImages = prev[activeChecklistId] || {};
                                    const sectionImages = currentListImages[sectionId] || [];
                                    const newImages = {
                                        ...prev,
                                        [activeChecklistId]: {
                                            ...currentListImages,
                                            [sectionId]: [...sectionImages, compressedBase64]
                                        }
                                    };

                                    // Imagens salvas APENAS no Supabase via auto-save effect
                                    // LocalStorage não armazena imagens para evitar QuotaExceededError

                                    return newImages;
                                });

                                e.target.value = '';

                            } catch (canvasError) {
                                console.error('Erro no canvas:', canvasError);
                                alert('❌ Erro ao processar a imagem. Tente novamente.');
                                e.target.value = '';
                            }
                        };

                        img.src = reader.result as string;

                    } catch (imgError) {
                        console.error('Erro ao criar Image:', imgError);
                        alert('❌ Erro ao carregar a imagem. Tente novamente.');
                        e.target.value = '';
                    }
                };

                reader.readAsDataURL(file);

            } catch (error) {
                console.error('Erro geral no upload:', error);
                alert('❌ Erro ao processar a imagem. Tente novamente.');
                e.target.value = '';
            }
        }
    };

    const removeImage = (sectionId: string, index: number) => {
        setImages(prev => {
            const currentListImages = prev[activeChecklistId] || {};
            const sectionImages = [...(currentListImages[sectionId] || [])];
            sectionImages.splice(index, 1);
            return {
                ...prev,
                [activeChecklistId]: {
                    ...currentListImages,
                    [sectionId]: sectionImages
                }
            };
        });
    };

    const handleSignature = (role: string, dataUrl: string) => {
        setSignatures(prev => {
            const updated: Record<string, Record<string, string>> = {};

            // Replicar assinatura para TODOS os checklists (como info básica)
            checklists.forEach(cl => {
                updated[cl.id] = {
                    ...(prev[cl.id] || {}),
                    [role]: dataUrl
                };
            });

            // Salvar imediatamente no localStorage
            if (currentUser) {
                const allDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
                allDrafts[currentUser.email] = {
                    formData: formData,
                    images: images,
                    signatures: updated,
                    ignoredChecklists: Array.from(ignoredChecklists)
                };
                localStorage.setItem('APP_DRAFTS', JSON.stringify(allDrafts));
            }

            return updated;
        });
    };

    // Helper to get data source (Draft or History Item)
    const getDataSource = (checkId: string) => {
        if (currentView === 'view_history' && viewHistoryItem) {
            return {
                data: viewHistoryItem.formData[checkId] || {},
                imgs: viewHistoryItem.images[checkId] || {},
                sigs: viewHistoryItem.signatures[checkId] || {}
            }
        }
        return {
            data: formData[checkId] || {},
            imgs: images[checkId] || {},
            sigs: signatures[checkId] || {}
        }
    };

    const getInputValue = (itemId: string, checklistId = activeChecklistId) => {
        const source = getDataSource(checklistId);
        return source.data[itemId] ?? '';
    };

    // --- ACTIONS ---

    const handleResetChecklist = () => {
        // Simple, direct confirmation. No event preventDefault magic needed here if connected properly.
        const shouldReset = window.confirm(
            "⚠️ TEM CERTEZA QUE DESEJA RECOMEÇAR?\n\nTodas as informações não salvas serão perdidas."
        );

        if (shouldReset) {
            if (currentUser) {
                // Delete from localStorage
                const allDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
                delete allDrafts[currentUser.email];
                localStorage.setItem('APP_DRAFTS', JSON.stringify(allDrafts));
                // Delete from Supabase (async, no await needed for UI reset)
                SupabaseService.deleteDraft(currentUser.email);
            }
            window.location.reload();
        }
    };

    const handleFinalizeAndSave = async () => {
        if (!currentUser) return;
        setIsSaving(true);

        try {
            // Get active checklists (not marked as "Não se Aplica")
            const activeChecklistIds = checklists.filter(cl => !ignoredChecklists.has(cl.id)).map(cl => cl.id);

            console.log('🔍 DEBUG - Checklists ativos:', activeChecklistIds);
            console.log('🔍 DEBUG - Checklists ignorados:', Array.from(ignoredChecklists));

            // VALIDAÇÃO 1: Deve ter pelo menos um checklist ativo
            if (activeChecklistIds.length === 0) {
                alert(
                    "❌ ERRO: Nenhum checklist ativo!\n\n" +
                    "Para finalizar, você precisa:\n" +
                    "✓ Preencher 100% de pelo menos UM checklist\n\n" +
                    "💡 Dica: Complete um checklist totalmente antes de finalizar."
                );
                setIsSaving(false);
                return;
            }

            // VALIDAÇÃO 2: Verificar se pelo menos UM checklist está 100% completo
            const completeChecklists = activeChecklistIds.filter(id => isChecklistComplete(id));

            console.log('🔍 DEBUG - Checklists completos:', completeChecklists);
            console.log('🔍 DEBUG - Total completos:', completeChecklists.length);

            if (completeChecklists.length === 0) {
                // Calcular percentual de cada checklist ativo
                const checklistStatus = activeChecklistIds.map(id => {
                    const cl = checklists.find(c => c.id === id);
                    const stats = getChecklistStats(id);
                    const sigs = signatures[id] || {};

                    // Contar campos obrigatórios preenchidos
                    let requiredFilled = 0;
                    let requiredTotal = 0;

                    cl?.sections.forEach(section => {
                        section.items.forEach(item => {
                            if (item.required) {
                                requiredTotal++;
                                const val = getInputValue(item.id, id);
                                if (val !== '' && val !== null && val !== undefined) {
                                    requiredFilled++;
                                }
                            }
                        });
                    });

                    // Contar assinaturas (2 obrigatórias)
                    const hasSigs = (sigs['gestor'] ? 1 : 0) + (sigs['coordenador'] ? 1 : 0);
                    const totalRequired = requiredTotal + 2; // +2 para as assinaturas
                    const totalFilled = requiredFilled + hasSigs;

                    const percentage = totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 0;

                    console.log(`🔍 DEBUG - ${cl?.title}: ${percentage}% (${totalFilled}/${totalRequired})`);

                    return {
                        id: id,
                        title: cl?.title || '',
                        percentage: percentage,
                        missing: totalRequired - totalFilled
                    };
                });

                const statusText = checklistStatus
                    .map(s => `  • ${s.title}: ${s.percentage}% (faltam ${s.missing} campos)`)
                    .join('\n');

                alert(
                    "⚠️ ATENÇÃO: Nenhum checklist está 100% completo!\n\n" +
                    "📊 Status atual:\n" +
                    statusText + "\n\n" +
                    "🚫 NÃO É POSSÍVEL FINALIZAR\n\n" +
                    "Para finalizar, você DEVE:\n" +
                    "✓ Preencher 100% de pelo menos UM checklist\n" +
                    "✓ OU marcar os checklists incompletos como 'Não se Aplica'\n\n" +
                    "💡 Dica: Complete todos os campos obrigatórios e ambas as assinaturas."
                );

                // Navegar para o checklist com maior percentual
                const bestChecklist = checklistStatus.reduce((best, current) =>
                    current.percentage > best.percentage ? current : best
                );

                setActiveChecklistId(bestChecklist.id);
                setCurrentView('checklist');
                setShowErrors(true);
                setTimeout(() => {
                    scrollToFirstMissing(bestChecklist.id);
                }, 300);

                console.log('❌ BLOQUEADO - Nenhum checklist 100% completo');
                setIsSaving(false);
                return;
            }

            // VALIDAÇÃO 3: Verificar se há checklists INCOMPLETOS entre os ativos
            const incompleteChecklists = activeChecklistIds.filter(id => !isChecklistComplete(id));

            console.log('🔍 DEBUG - Checklists incompletos:', incompleteChecklists);

            if (incompleteChecklists.length > 0) {
                const incompleteNames = incompleteChecklists.map(id => {
                    const cl = checklists.find(c => c.id === id);
                    const stats = getChecklistStats(id);
                    const sigs = signatures[id] || {};

                    // Calcular percentual
                    let requiredFilled = 0;
                    let requiredTotal = 0;

                    cl?.sections.forEach(section => {
                        section.items.forEach(item => {
                            if (item.required) {
                                requiredTotal++;
                                const val = getInputValue(item.id, id);
                                if (val !== '' && val !== null && val !== undefined) {
                                    requiredFilled++;
                                }
                            }
                        });
                    });

                    const hasSigs = (sigs['gestor'] ? 1 : 0) + (sigs['coordenador'] ? 1 : 0);
                    const totalRequired = requiredTotal + 2;
                    const totalFilled = requiredFilled + hasSigs;
                    const percentage = totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 0;

                    return `  • ${cl?.title}: ${percentage}% preenchido`;
                }).join('\n');

                const completeNames = completeChecklists.map(id => {
                    const cl = checklists.find(c => c.id === id);
                    return `  ✅ ${cl?.title}`;
                }).join('\n');

                alert(
                    "🚨 CHECKLISTS INCOMPLETOS DETECTADOS!\n\n" +
                    "Checklists completos (100%):\n" +
                    completeNames + "\n\n" +
                    "⚠️ Checklists incompletos:\n" +
                    incompleteNames + "\n\n" +
                    "🚫 VOCÊ NÃO PODE FINALIZAR COM CHECKLISTS INCOMPLETOS!\n\n" +
                    "Escolha UMA das opções:\n" +
                    "1️⃣ COMPLETAR: Preencher 100% dos checklists incompletos\n" +
                    "2️⃣ MARCAR 'NÃO SE APLICA': Desmarcar os checklists incompletos\n\n" +
                    "💡 Só é possível salvar quando TODOS os checklists ativos estiverem 100% completos."
                );

                // Navegar para o primeiro checklist incompleto
                setActiveChecklistId(incompleteChecklists[0]);
                setCurrentView('checklist');
                setShowErrors(true);
                setTimeout(() => {
                    scrollToFirstMissing(incompleteChecklists[0]);
                }, 300);

                console.log('❌ BLOQUEADO - Existem checklists incompletos');
                setIsSaving(false);
                return;
            }

            console.log('✅ VALIDAÇÕES PASSARAM - Salvando relatório...');

            // ✅ TUDO OK - Pode finalizar!

            const score = calculateGlobalScore();

            console.log('💾 Salvando relatório no Supabase...');

            // Checar duplicidade antes de criar
            const candidateReport = {
                user_email: currentUser.email,
                user_name: currentUser.name,
                pharmacy_name: config.pharmacyName,
                score: score,
                form_data: { ...formData },
                images: { ...images },
                signatures: { ...signatures },
                ignored_checklists: Array.from(ignoredChecklists)
            };

            // Save to Supabase first
            const dbReport = await SupabaseService.createReport(candidateReport as any);

            if (!dbReport) {
                throw new Error('Falha ao salvar relatório no Supabase');
            }

            console.log('✅ Relatório salvo:', dbReport.id);

            const newReport: ReportHistoryItem = {
                id: dbReport.id,
                userEmail: currentUser.email,
                userName: currentUser.name,
                date: dbReport.created_at,
                pharmacyName: config.pharmacyName,
                score: score,
                formData: { ...formData },
                images: { ...images },
                signatures: { ...signatures },
                ignoredChecklists: Array.from(ignoredChecklists)
            };

            // Force refresh reports from Supabase to ensure sync across devices
            console.log('🔄 Recarregando todos os relatórios do Supabase...');
            const dbReports = await SupabaseService.fetchReportsSummary(0, 30);
            const formattedReports = dbReports.map(mapDbReportToHistoryItem);
            setReportHistory(formattedReports);
            await refreshStockConferenceReports();
            console.log('✅ Relatórios atualizados:', formattedReports.length, 'itens');

            // Clear Draft from state
            setFormData({});
            setImages({});
            setSignatures({});
            setIgnoredChecklists(new Set());

            // Clear from Supabase
            await SupabaseService.deleteDraft(currentUser.email);

            console.log('✅ Finalizando - redirecionando para visualização');

            // Redirect to View History (Report View)
            setIsSaving(false);
            setViewHistoryItem(newReport);
            setCurrentView('view_history');

            // Scroll to top
            window.scrollTo(0, 0);

        } catch (error) {
            console.error('❌ Erro ao finalizar relatório:', error);
            setIsSaving(false);
            alert('Erro ao salvar relatório. Por favor, tente novamente ou verifique sua conexão.');

            // Em caso de erro, tentar recarregar relatórios do Supabase
            try {
                const dbReports = await SupabaseService.fetchReports();
                const formattedReports = dbReports.map(mapDbReportToHistoryItem);
                setReportHistory(formattedReports);
                await refreshStockConferenceReports();
                setCurrentView('history');
            } catch (reloadError) {
                console.error('❌ Erro ao recarregar relatórios:', reloadError);
            }
        }
    };

    const handleViewHistoryItem = async (item: ReportHistoryItem) => {
        let fullReport = item;

        // Se o relatório não tiver imagens ou assinaturas (que não vêm no summary), buscamos os detalhes
        // Nota: form_data sempre vem, mas images e signatures podem estar vazios no summary
        const hasImages = Object.keys(item.images || {}).length > 0;
        const hasSignatures = Object.keys(item.signatures || {}).length > 0;

        if (!hasImages && !hasSignatures) {
            try {
                const detailedData = await SupabaseService.fetchReportDetails(item.id);
                if (detailedData) {
                    fullReport = mapDbReportToHistoryItem(detailedData);
                    // Atualizar o cache local para não buscar novamente
                    setReportHistory(prev => prev.map(r => r.id === item.id ? fullReport : r));
                }
            } catch (error) {
                console.error('Error fetching report details:', error);
            }
        }

        setViewHistoryItem(fullReport);
        setCurrentView('view_history');
    };

    const handleDownloadPDF = () => {
        // 1. Get current title
        const originalTitle = document.title;

        // 2. Try to get Filial and Date using robust scan
        let filial = 'Sem_Filial';
        const targetChecklists = ['gerencial', ...checklists.map(c => c.id)]; // Prioritize 'gerencial' where the field lives

        for (const checkId of targetChecklists) {
            const data = viewHistoryItem ? viewHistoryItem.formData[checkId] : formData[checkId];
            if (data?.filial && String(data.filial).trim() !== '') {
                filial = String(data.filial);
                break;
            }
        }

        // Date logic
        let dateRaw = new Date().toLocaleDateString('pt-BR');
        for (const checkId of targetChecklists) {
            const data = viewHistoryItem ? viewHistoryItem.formData[checkId] : formData[checkId];
            if (data?.data_aplicacao) {
                dateRaw = String(data.data_aplicacao);
                break;
            }
        }

        // 3. Format filename
        const safeFilial = filial.trim().replace(/\s+/g, '_');
        const safeDate = dateRaw.replace(/\//g, '-');
        const filename = `Relatorio_${safeFilial}_${safeDate}`;

        // 4. Set title (browser uses this as filename)
        document.title = filename;

        // 5. Open print dialog immediately
        window.print();

        // 6. Restore title after a safe delay
        setTimeout(() => {
            document.title = originalTitle;
        }, 2000);
    };


    // --- VALIDATION & SCORING LOGIC ---

    const getSectionStatus = (section: ChecklistSection, checklistId = activeChecklistId) => {
        let totalItems = 0;
        let answeredItems = 0;
        let scoreTotal = 0;
        let scorePassed = 0;
        let scoreableItems = 0; // Items that contribute to the star rating

        section.items.forEach(item => {
            if (item.type !== InputType.HEADER && item.type !== InputType.INFO) {
                totalItems++;
                const val = getInputValue(item.id, checklistId);
                if (val !== '' && val !== null && val !== undefined) {
                    answeredItems++;
                }
                if (item.type === InputType.BOOLEAN_PASS_FAIL) {
                    scoreableItems++;
                    if (val !== '' && val !== null && val !== undefined) {
                        scoreTotal++;
                        if (val === 'pass') scorePassed++;
                    }
                }
            }
        });

        const isComplete = totalItems > 0 && totalItems === answeredItems;
        const predictedScore = scoreTotal === 0 ? 0 : (scorePassed / scoreTotal) * 5;

        return { totalItems, answeredItems, isComplete, predictedScore, scoreableItems };
    };

    const isChecklistComplete = (checklistId: string) => {
        // If viewing history, consider it complete (read only)
        if (currentView === 'view_history') return true;

        const checklist = checklists.find(c => c.id === checklistId);
        if (!checklist) return false;

        for (const section of checklist.sections) {
            for (const item of section.items) {
                const val = getInputValue(item.id, checklistId);
                if (item.required && (val === '' || val === null || val === undefined)) return false;
            }
        }
        const currentSigs = signatures[checklistId] || {};
        // EXIGIR assinatura de gestor E coordenador
        if (!currentSigs['gestor'] || !currentSigs['coordenador']) return false;

        return true;
    };

    const getChecklistStats = (checklistId: string) => {
        const checklist = checklists.find(c => c.id === checklistId);
        if (!checklist) return { score: 0, passed: 0, total: 0, failedItems: [], missingItems: [], unansweredItems: [] };

        let totalBoolean = 0;
        let passed = 0;
        let failedItems: { text: string, section: string }[] = [];
        let missingItems: { text: string, section: string }[] = [];
        let unansweredItems: { text: string, section: string }[] = [];

        checklist.sections.forEach(section => {
            section.items.forEach(item => {
                const val = getInputValue(item.id, checklistId);

                // Check for missing required items
                if (item.required && (val === '' || val === null || val === undefined)) {
                    missingItems.push({ text: item.text, section: section.title });
                }

                if (item.type === InputType.BOOLEAN_PASS_FAIL) {
                    totalBoolean++;
                    if (val === 'pass') {
                        passed++;
                    } else if (val === 'fail') {
                        failedItems.push({ text: item.text, section: section.title });
                    } else if (val === '' || val === null || val === undefined) {
                        // Track unanswered items that are not strictly required but impact score
                        unansweredItems.push({ text: item.text, section: section.title });
                    }
                }
            });
        });

        const score = totalBoolean === 0 ? 0 : (passed / totalBoolean) * 5;
        return { score, passed, total: totalBoolean, failedItems, missingItems, unansweredItems };
    };

    const calculateGlobalScore = (historyItem?: ReportHistoryItem) => {
        let totalSum = 0;
        let count = 0;

        const ignoredSet = historyItem ? new Set(historyItem.ignoredChecklists) : ignoredChecklists;

        checklists.forEach(cl => {
            if (!ignoredSet.has(cl.id)) {
                const stats = getChecklistStats(cl.id);
                if (stats.total > 0) {
                    totalSum += stats.score;
                    count++;
                }
            }
        });

        return count === 0 ? "0.0" : (totalSum / count).toFixed(1);
    };

    const getScoreFeedback = (scoreNum: number) => {
        if (scoreNum >= 4.5) return { label: 'Excelente', color: 'text-purple-600', bg: 'bg-purple-100', icon: <PartyPopper size={48} className="text-purple-500 animate-bounce" />, msg: 'Parabéns! Desempenho Excepcional!' };
        if (scoreNum >= 4.0) return { label: 'Ótimo', color: 'text-blue-600', bg: 'bg-blue-100', icon: <Trophy size={48} className="text-blue-500 animate-pulse" />, msg: 'Parabéns! Muito bom trabalho!' };
        if (scoreNum >= 3.0) return { label: 'Bom', color: 'text-green-600', bg: 'bg-green-100', icon: <CheckCircle size={48} className="text-green-500" />, msg: 'Parabéns! Bom resultado.' };
        if (scoreNum >= 2.0) return { label: 'Melhorar Urgente', color: 'text-orange-600', bg: 'bg-orange-100', icon: <AlertTriangle size={48} className="text-orange-500" />, msg: 'Atenção: Pontos de melhoria necessários.' };
        return { label: 'Ruim', color: 'text-red-600', bg: 'bg-red-100', icon: <Frown size={48} className="text-red-500" />, msg: 'Crítico: Necessita revisão imediata.' };
    };

    const toggleIgnoreChecklist = (id: string) => {
        setIgnoredChecklists(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Função para scroll e highlight do primeiro item faltante
    const scrollToFirstMissing = (checklistId: string) => {
        const stats = getChecklistStats(checklistId);
        const currentSigs = signatures[checklistId] || {};

        // Verificar primeiro item faltante
        if (stats.missingItems.length > 0) {
            const firstMissing = stats.missingItems[0];
            // Encontrar o elemento no DOM pelo ID do item
            const checklist = checklists.find(c => c.id === checklistId);
            if (checklist) {
                for (const section of checklist.sections) {
                    for (const item of section.items) {
                        if (item.text === firstMissing.text) {
                            const element = document.getElementById(item.id);
                            if (element) {
                                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                element.classList.add('highlight-missing');
                                setTimeout(() => element.classList.remove('highlight-missing'), 3000);
                                return;
                            }
                        }
                    }
                }
            }
        }

        // Verificar assinaturas faltantes
        if (!currentSigs['gestor']) {
            const gestorSig = document.querySelector('[data-signature="gestor"]');
            if (gestorSig) {
                gestorSig.scrollIntoView({ behavior: 'smooth', block: 'center' });
                gestorSig.classList.add('highlight-missing');
                setTimeout(() => gestorSig.classList.remove('highlight-missing'), 3000);
                return;
            }
        }

        if (!currentSigs['coordenador']) {
            const coordSig = document.querySelector('[data-signature="coordenador"]');
            if (coordSig) {
                coordSig.scrollIntoView({ behavior: 'smooth', block: 'center' });
                coordSig.classList.add('highlight-missing');
                setTimeout(() => coordSig.classList.remove('highlight-missing'), 3000);
                return;
            }
        }

        // Se não encontrou nada específico, scroll para o error box
        errorBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const handleVerify = () => {
        setShowErrors(true);

        const stats = getChecklistStats(activeChecklistId);
        const currentSigs = signatures[activeChecklistId] || {};
        const hasSigMissing = !currentSigs['gestor'] || !currentSigs['coordenador'];

        if (stats.missingItems.length > 0 || hasSigMissing || stats.unansweredItems.length > 0) {
            // Scroll para o primeiro item faltante com highlight
            setTimeout(() => {
                scrollToFirstMissing(activeChecklistId);
            }, 100);
        } else {
            alert("Checklist completo! Você pode prosseguir.");
        }
    };

    const handleViewChange = (view: typeof currentView) => {
        if (view === 'checklist') {
            setViewHistoryItem(null); // Clear history view if going back to draft
            setShowErrors(false);
        }
        setCurrentView(view);
        window.scrollTo(0, 0);
        setIsSidebarOpen(false);
    };

    const handleNextChecklist = () => {
        // Validate Current Checklist first
        const stats = getChecklistStats(activeChecklistId);
        const currentSigs = signatures[activeChecklistId] || {};
        const hasSigMissing = !currentSigs['gestor'] || !currentSigs['coordenador'];

        if (stats.missingItems.length > 0 || hasSigMissing) {
            setShowErrors(true);
            setTimeout(() => {
                scrollToFirstMissing(activeChecklistId);
            }, 100);
            return; // Block navigation
        }

        const idx = checklists.findIndex(c => c.id === activeChecklistId);
        if (idx < checklists.length - 1) {
            setActiveChecklistId(checklists[idx + 1].id);
            window.scrollTo(0, 0);
            setShowErrors(false);
        } else {
            handleViewChange('summary');
        }
    };

    // --- FILTERED HISTORY ---
    const toggleStockBranchFilter = (branchKey: string) => {
        setStockBranchFilters(prev => prev.includes(branchKey) ? prev.filter(k => k !== branchKey) : [...prev, branchKey]);
    };

    const handleResetStockBranchFilters = () => setStockBranchFilters([]);

    const handleStockAreaFilterChange = (value: string) => setStockAreaFilter(value);

    const getFilteredHistory = () => {
        if (canModerateHistory) {
            if (historyFilterUser === 'all') return reportHistory;
            return reportHistory.filter(r => r.userEmail === historyFilterUser);
        }

        const allowed = new Set<string>(['asconavietagestor@gmail.com']);
        if (currentUser?.email) allowed.add(currentUser.email);
        const base = reportHistory.filter(r => allowed.has(r.userEmail));
        if (historyFilterUser === 'all') return base;
        if (!allowed.has(historyFilterUser)) return [];
        return base.filter(r => r.userEmail === historyFilterUser);
    };

    // --- RENDER ---

    // Loading Screen
    if (isLoadingData) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-[6.666rem] h-[6.666rem] mx-auto mb-6">
                        <MFLogo className="w-full h-full animate-pulse" />
                    </div>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                    <p className="text-white font-bold text-lg">Carregando dados...</p>
                    <p className="text-white/80 text-sm mt-2">Conectando ao banco de dados</p>
                </div>
            </div>
        );
    }

    if (!currentUser) {
        return (
            <>
                <LoginScreen onLogin={handleLogin} users={users} onRegister={handleRegister} companies={companies} />
            </>
        );
    }

    // Determine if we are in "Read Only" mode (History View)
    const canControlChecklists = hasModuleAccess('checklistControl');
    const canEditCompanies = hasModuleAccess('companyEditing');
    const canManageUsers = hasModuleAccess('userManagement');
    const canRespondTickets = hasModuleAccess('supportTickets');
    const canModerateHistory = hasModuleAccess('historyModeration');
    const canApproveUsers = hasModuleAccess('userApproval');
    const isReadOnly = currentView === 'view_history' || !canControlChecklists;

    // Dynamic Header Logic: Use 'filial' input if available, otherwise default config
    const getDynamicPharmacyName = () => {
        if (viewHistoryItem) return viewHistoryItem.pharmacyName;

        // Try to find 'filial' in active draft data (prioritize 'gerencial')
        const targetChecklists = ['gerencial', ...checklists.map(c => c.id)];
        for (const checkId of targetChecklists) {
            const data = formData[checkId];
            if (data?.filial && String(data.filial).trim() !== '') {
                return String(data.filial);
            }
        }
        return config.pharmacyName;
    };

    const displayConfig = { ...config, pharmacyName: getDynamicPharmacyName() };

    // Calculate current checklist specific stats for render
    const currentChecklistStats = getChecklistStats(activeChecklistId);
    const currentMissingItems = currentChecklistStats.missingItems;
    const currentUnansweredItems = currentChecklistStats.unansweredItems;
    const currentSigMissing = !signatures[activeChecklistId]?.['gestor'];

    // Get Basic Info from First Active Checklist
    // We assume all checklists have synced info, so we take from the first one in the list.
    const basicInfoSourceChecklist = checklists[0]?.id || 'gerencial'; // Always defaults to 'gerencial', or first one. 
    // If 'gerencial' is ignored, we still have the data because syncing happens on input.
    // Actually, for display in report, we should just use the first checklist in the definitions, as they are synced.

    return (
        <div className="min-h-screen bg-gray-50 flex font-sans text-gray-800">
            <Sidebar
                isSidebarOpen={isSidebarOpen}
                setIsSidebarOpen={setIsSidebarOpen}
                currentUser={currentUser}
                currentTheme={currentTheme}
                displayConfig={displayConfig}
                companies={companies}
                handleViewChange={handleViewChange}
                currentView={currentView}
                activeChecklistId={activeChecklistId}
                setActiveChecklistId={setActiveChecklistId}
                checklists={checklists}
                isChecklistComplete={isChecklistComplete}
                ignoredChecklists={ignoredChecklists}
                canControlChecklists={canControlChecklists}
                handleLogout={handleLogout}
            />

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50/50 relative">
                {/* Background Mesh Gradient */}
                <div className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-gray-200 via-transparent to-transparent"></div>

                <Header
                    isSidebarOpen={isSidebarOpen}
                    setIsSidebarOpen={setIsSidebarOpen}
                    currentTheme={currentTheme}
                    displayConfig={displayConfig}
                    companies={companies}
                    currentView={currentView}
                    activeChecklist={activeChecklist}
                    canControlChecklists={canControlChecklists}
                    handleResetChecklist={handleResetChecklist}
                    currentUser={currentUser}
                    activeChecklistId={activeChecklistId}
                    openChecklistEditor={openChecklistEditor}
                />

                {/* Main Body */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-10 z-10 scroll-smooth">
                    {/* Prominent Pending Users Alert at Top */}
                    {canApproveUsers && pendingUsersCount > 0 && (
                        <div className="mb-8 bg-red-600 rounded-2xl p-6 text-white shadow-2xl shadow-red-200 relative overflow-hidden group transform hover:-translate-y-1 transition-all max-w-2xl mx-auto">
                            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/diagonal-stripes.png')] opacity-10"></div>

                            <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-white text-red-600 flex items-center justify-center font-black text-xl shadow-inner animate-pulse shrink-0">
                                        {pendingUsersCount}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black uppercase tracking-tight mb-1">Aprovação Pendente</h3>
                                        <p className="text-red-100 font-medium text-sm">Usuários aguardando liberação de acesso.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Inline List of Pending Users */}
                            <div className="relative z-10 mt-6 space-y-3">
                                {pendingUsers.map(u => (
                                    <div key={u.email} className="bg-white/10 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 border border-white/20">
                                        <div className="flex flex-col text-center sm:text-left">
                                            <span className="font-bold text-sm">{u.name}</span>
                                            <span className="text-xs opacity-80">{u.email}</span>
                                        </div>
                                        <div className="flex items-center gap-2 w-full sm:w-auto">
                                            <button
                                                onClick={() => updateUserStatus(u.email, true)}
                                                className="flex-1 sm:flex-none bg-green-500 hover:bg-green-400 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm"
                                            >
                                                Aprovar
                                            </button>
                                            <button
                                                onClick={() => handleRejectUser(u.email)}
                                                className="flex-1 sm:flex-none bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                            >
                                                Recusar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* --- STOCK CONFERENCE VIEW --- */}
                    {currentView === 'stock' && (
                        <div className="h-full animate-fade-in relative pb-24">
                            <StockConference
                                userEmail={currentUser?.email || ''}
                                userName={currentUser?.name || ''}
                                companies={companies}
                                onReportSaved={async () => { await refreshStockConferenceReports(); }}
                            />
                        </div>
                    )}

                    {currentView === 'pre' && (
                        <div className="h-full animate-fade-in relative pb-24">
                            <PreVencidosManager
                                userEmail={currentUser?.email || ''}
                                userName={currentUser?.name || ''}
                                companies={companies}
                            />
                        </div>
                    )}

                    {/* --- SETTINGS VIEW --- */}
                    {currentView === 'settings' && (
                        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in relative pb-24">

                            {/* Appearance Settings */}
                            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                                <h2 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-3 border-b border-gray-100 pb-4">
                                    <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                        <Palette size={24} className={currentTheme.text} />
                                    </div>
                                    Área da Empresa
                                </h2>

                                <div className="space-y-10">
                                    {/* Company View for Standard Users (Read Only) */}
                                    {currentUser.role !== 'MASTER' && currentUser.company_id && (() => {
                                        const userCompany = companies.find(c => c.id === currentUser.company_id);
                                        if (!userCompany) return (
                                            <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg flex items-center gap-2">
                                                <AlertTriangle size={20} />
                                                <p className="text-sm font-medium">Você está vinculado a uma empresa, mas os dados dela não foram encontrados.</p>
                                            </div>
                                        );

                                        return (
                                            <div className="space-y-6 animate-fade-in">
                                                {/* Read Only Header */}
                                                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-center gap-3">
                                                    <Building2 className="text-blue-600" size={24} />
                                                    <div>
                                                        <p className="text-sm font-bold text-blue-900 uppercase tracking-wide">Sua Empresa</p>
                                                        <p className="text-xs text-blue-700">Você está visualizando os dados da empresa vinculada à sua conta.</p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Nome da Empresa</label>
                                                        <input
                                                            type="text"
                                                            value={userCompany.name}
                                                            disabled
                                                            className="w-full bg-gray-100 border border-gray-300 rounded-lg p-2.5 text-sm text-gray-600 cursor-not-allowed shadow-inner-light"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">CNPJ</label>
                                                        <input
                                                            type="text"
                                                            value={userCompany.cnpj || '-'}
                                                            disabled
                                                            className="w-full bg-gray-100 border border-gray-300 rounded-lg p-2.5 text-sm text-gray-600 cursor-not-allowed shadow-inner-light"
                                                        />
                                                    </div>
                                                    <div className="md:col-span-2">
                                                        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Telefone</label>
                                                        <input
                                                            type="text"
                                                            value={userCompany.phone || '-'}
                                                            disabled
                                                            className="w-full bg-gray-100 border border-gray-300 rounded-lg p-2.5 text-sm text-gray-600 cursor-not-allowed shadow-inner-light"
                                                        />
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Logo da Empresa</label>
                                                    <div className="h-32 w-48 bg-gray-100 rounded-xl border border-gray-300 flex items-center justify-center overflow-hidden relative shadow-inner">
                                                        {userCompany.logo ? (
                                                            <img src={userCompany.logo} alt="Logo da Empresa" className="max-h-full max-w-full object-contain p-2" />
                                                        ) : (
                                                            <div className="text-center text-gray-400">
                                                                <ImageIcon size={32} className="mx-auto mb-1 opacity-50" />
                                                                <span className="text-xs block">Sem Logo</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="h-px bg-gray-200 my-6"></div>
                                            </div>
                                        );
                                    })()}

                                    {/* Company Selection Dropdown (MASTER ONLY) */}
                                    {canEditCompanies && (
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Selecionar Empresa para Editar</label>
                                            <select
                                                value={selectedCompanyId || ''}
                                                onChange={(e) => {
                                                    const companyId = e.target.value;
                                                    setSelectedCompanyId(companyId);
                                                    if (companyId) {
                                                        const company = companies.find(c => c.id === companyId);
                                                        if (company) {
                                                            setEditCompanyName(company.name);
                                                            setEditCompanyCnpj(company.cnpj || '');
                                                            setEditCompanyPhone(company.phone || '');
                                                            setEditCompanyLogo(company.logo || null);
                                                            setEditCompanyAreas(company.areas || []);

                                                            // Bidirectional sync: Update empresa in all checklists
                                                            setFormData(prev => {
                                                                const newData = { ...prev };
                                                                checklists.forEach(cl => {
                                                                    newData[cl.id] = {
                                                                        ...(newData[cl.id] || {}),
                                                                        empresa: company.name
                                                                    };
                                                                });
                                                                return newData;
                                                            });
                                                        }
                                                    }
                                                }}
                                                className="w-full bg-white border border-gray-300 rounded-xl p-3 text-gray-900 focus:ring-2 focus:ring-red-500 outline-none shadow-inner-light transition-all"
                                            >
                                                <option value="">-- Selecione uma Empresa --</option>
                                                {companies.map(company => (
                                                    <option key={company.id} value={company.id}>{company.name}</option>
                                                ))}
                                            </select>
                                            <p className="text-xs text-gray-500 mt-2 font-medium">Selecione a empresa que deseja editar e configurar áreas/filiais.</p>
                                        </div>
                                    )}

                                    {/* Editable Company Fields (only show if company is selected AND user is MASTER) */}
                                    {selectedCompanyId && canEditCompanies && (
                                        <>
                                            {/* Basic Company Info */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Nome da Empresa</label>
                                                    <input
                                                        type="text"
                                                        value={editCompanyName}
                                                        onChange={(e) => setEditCompanyName(e.target.value)}
                                                        placeholder="Nome da Empresa"
                                                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">CNPJ</label>
                                                    <input
                                                        type="text"
                                                        value={editCompanyCnpj}
                                                        onChange={(e) => setEditCompanyCnpj(e.target.value)}
                                                        placeholder="CNPJ (Opcional)"
                                                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Telefone</label>
                                                    <input
                                                        type="text"
                                                        value={editCompanyPhone}
                                                        onChange={(e) => setEditCompanyPhone(e.target.value)}
                                                        placeholder="Telefone (Opcional)"
                                                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                </div>
                                            </div>

                                            {/* Logo Upload */}
                                            <div className="col-span-1 md:col-span-2">
                                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Logo da Empresa</label>
                                                <div className="flex items-center gap-8 bg-gray-50 p-6 rounded-2xl border border-gray-200">
                                                    <div className="h-28 w-44 bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center overflow-hidden relative">
                                                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/graphy.png')] opacity-10"></div>
                                                        {editCompanyLogo ? (
                                                            <img src={editCompanyLogo} alt="Preview" className="h-full w-full object-contain p-2 relative z-10" />
                                                        ) : (
                                                            <ImageIcon className="text-gray-300 relative z-10" size={40} />
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col gap-3">
                                                        <label className="cursor-pointer inline-flex items-center px-5 py-2.5 border border-gray-300 shadow-sm text-sm font-bold rounded-lg text-gray-700 bg-white hover:bg-gray-50 hover:shadow-md transition-all">
                                                            <Upload size={18} className="mr-2" />
                                                            Carregar Imagem
                                                            <input
                                                                type="file"
                                                                className="hidden"
                                                                accept="image/*"
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0];
                                                                    if (file) {
                                                                        const reader = new FileReader();
                                                                        reader.onloadend = () => {
                                                                            setEditCompanyLogo(reader.result as string);
                                                                        };
                                                                        reader.readAsDataURL(file);
                                                                    }
                                                                }}
                                                            />
                                                        </label>
                                                        {editCompanyLogo && (
                                                            <button
                                                                onClick={() => setEditCompanyLogo(null)}
                                                                className="text-sm text-red-600 hover:text-red-800 font-semibold"
                                                            >
                                                                Remover Logo
                                                            </button>
                                                        )}
                                                        <p className="text-xs text-gray-400">Recomendado: PNG Transparente</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Areas and Branches Management */}
                                            <div>
                                                <div className="flex justify-between items-center mb-4">
                                                    <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide">Áreas e Filiais</label>
                                                    <button
                                                        onClick={() => {
                                                            if (editCompanyAreas.length < 5) {
                                                                setEditCompanyAreas([...editCompanyAreas, { name: '', branches: [] }]);
                                                            }
                                                        }}
                                                        disabled={editCompanyAreas.length >= 5}
                                                        className={`text-sm font-bold px-4 py-2 rounded-lg transition-all ${editCompanyAreas.length >= 5
                                                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                                            : 'bg-blue-600 text-white hover:bg-blue-700'
                                                            }`}
                                                    >
                                                        + Adicionar Área
                                                    </button>
                                                </div>
                                                <div className="space-y-4">
                                                    {editCompanyAreas.map((area, index) => (
                                                        <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200 relative group">
                                                            <button
                                                                onClick={() => {
                                                                    setEditCompanyAreas(editCompanyAreas.filter((_, i) => i !== index));
                                                                }}
                                                                className="absolute top-2 right-2 text-red-600 hover:text-red-800 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            >
                                                                <X size={18} />
                                                            </button>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                <div>
                                                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Nome da Área</label>
                                                                    <input
                                                                        type="text"
                                                                        value={area.name}
                                                                        onChange={(e) => {
                                                                            const newAreas = [...editCompanyAreas];
                                                                            newAreas[index].name = e.target.value;
                                                                            setEditCompanyAreas(newAreas);
                                                                        }}
                                                                        placeholder="Ex: Área 1"
                                                                        className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Filiais (Separadas por ponto e vírgula)</label>
                                                                    <input
                                                                        type="text"
                                                                        defaultValue={area.branches.join('; ')}
                                                                        onBlur={(e) => {
                                                                            const newAreas = [...editCompanyAreas];
                                                                            newAreas[index].branches = e.target.value.split(';').map(b => b.trim()).filter(Boolean);
                                                                            setEditCompanyAreas(newAreas);
                                                                        }}
                                                                        placeholder="Ex: Filial 1; Filial 2; Matriz..."
                                                                        className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Save Button */}
                                            <div className="flex justify-end pt-4">
                                                <button
                                                    onClick={async () => {
                                                        if (!selectedCompanyId) return;
                                                        try {
                                                            // Update company in Supabase
                                                            await updateCompany(selectedCompanyId, {
                                                                name: editCompanyName,
                                                                cnpj: editCompanyCnpj,
                                                                phone: editCompanyPhone,
                                                                logo: editCompanyLogo,
                                                                areas: editCompanyAreas
                                                            });

                                                            // Update local state
                                                            setCompanies(companies.map(c =>
                                                                c.id === selectedCompanyId
                                                                    ? { ...c, name: editCompanyName, cnpj: editCompanyCnpj, phone: editCompanyPhone, logo: editCompanyLogo, areas: editCompanyAreas }
                                                                    : c
                                                            ));

                                                            // Update config if this is the active company
                                                            if (config.pharmacyName === companies.find(c => c.id === selectedCompanyId)?.name) {
                                                                const newConfig = { pharmacy_name: editCompanyName, logo: editCompanyLogo };
                                                                setConfig({ pharmacyName: editCompanyName, logo: editCompanyLogo });
                                                                await saveConfig(newConfig);
                                                            }

                                                            alert('Empresa atualizada com sucesso!');
                                                        } catch (error) {
                                                            console.error('Erro ao atualizar empresa:', error);
                                                            alert('Erro ao salvar alterações');
                                                        }
                                                    }}
                                                    className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all"
                                                >
                                                    Salvar Alterações
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    {/* Theme Color Selection */}
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Cor do Tema</label>
                                        <div className="flex gap-4">
                                            {(['red', 'green', 'blue', 'yellow'] as ThemeColor[]).map(color => (
                                                <button
                                                    key={color}
                                                    onClick={() => handleUpdateUserTheme(color)}
                                                    className={`w-12 h-12 rounded-xl shadow-md border-2 ${THEMES[color].bg} ${(currentUser?.preferredTheme || 'blue') === color ? 'border-gray-800 scale-110 ring-2 ring-offset-2 ring-gray-300' : 'border-transparent opacity-80 hover:opacity-100'} transition-all transform hover:scale-105`}
                                                    title={color}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Company Management Section (MASTER only) */}
                            {canEditCompanies && (
                                <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                                    <h2 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-3 border-b border-gray-100 pb-4">
                                        <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                            <Upload size={24} className={currentTheme.text} />
                                        </div>
                                        Gerenciamento de Empresas
                                    </h2>

                                    {/* Company Registration Form */}
                                    <div className="mb-8 bg-gray-50 p-6 rounded-xl border border-gray-200">
                                        <h3 className="text-sm font-bold text-gray-700 uppercase mb-4 flex items-center gap-2">
                                            <UserPlus size={16} /> Cadastrar Nova Empresa
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-600 uppercase mb-2">Nome da Empresa *</label>
                                                <input
                                                    type="text"
                                                    value={newCompanyName}
                                                    onChange={(e) => setNewCompanyName(e.target.value)}
                                                    placeholder="Nome da Empresa"
                                                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-600 uppercase mb-2">CNPJ</label>
                                                <input
                                                    type="text"
                                                    value={newCompanyCnpj}
                                                    onChange={(e) => setNewCompanyCnpj(e.target.value)}
                                                    placeholder="CNPJ (Opcional)"
                                                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className="block text-xs font-bold text-gray-600 uppercase mb-2">Telefone</label>
                                                <input
                                                    type="text"
                                                    value={newCompanyPhone}
                                                    onChange={(e) => setNewCompanyPhone(e.target.value)}
                                                    placeholder="Telefone (Opcional)"
                                                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                            </div>
                                        </div>

                                        {/* Logo Upload for New Company */}
                                        <div className="mb-6">
                                            <label className="block text-xs font-bold text-gray-600 uppercase mb-2">Logo da Empresa</label>
                                            <div className="flex items-center gap-4">
                                                <label className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-bold rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-all">
                                                    <Upload size={16} className="mr-2" />
                                                    Carregar Logo
                                                    <input
                                                        type="file"
                                                        className="hidden"
                                                        accept="image/*"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const reader = new FileReader();
                                                                reader.onloadend = () => {
                                                                    setNewCompanyLogo(reader.result as string);
                                                                };
                                                                reader.readAsDataURL(file);
                                                            }
                                                        }}
                                                    />
                                                </label>
                                                {newCompanyLogo && (
                                                    <div className="h-10 w-10 relative">
                                                        <img src={newCompanyLogo} className="h-full w-full object-contain rounded border" />
                                                        <button onClick={() => setNewCompanyLogo(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5"><X size={10} /></button>
                                                    </div>
                                                )}
                                                <span className="text-xs text-gray-400">PNG ou JPG (Recomendado: PNG Transparente)</span>
                                            </div>
                                        </div>

                                        {/* Areas and Branches for New Company */}
                                        <div className="mb-6">
                                            <div className="flex justify-between items-center mb-3">
                                                <label className="block text-xs font-bold text-gray-600 uppercase">Áreas e Filiais</label>
                                                <button
                                                    onClick={() => {
                                                        if (newCompanyAreas.length < 5) {
                                                            setNewCompanyAreas([...newCompanyAreas, { name: '', branches: [] }]);
                                                        }
                                                    }}
                                                    disabled={newCompanyAreas.length >= 5}
                                                    className="text-sm font-bold px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50"
                                                >
                                                    + Adicionar Área
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 mb-3">Adicione até 5 áreas com suas respectivas filiais</p>
                                            <div className="space-y-3">
                                                {newCompanyAreas.map((area, index) => (
                                                    <div key={index} className="bg-white p-3 rounded border border-gray-200 relative">
                                                        <button
                                                            onClick={() => setNewCompanyAreas(newCompanyAreas.filter((_, i) => i !== index))}
                                                            className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nome da Área</label>
                                                                <input
                                                                    type="text"
                                                                    value={area.name}
                                                                    onChange={(e) => {
                                                                        const copy = [...newCompanyAreas];
                                                                        copy[index].name = e.target.value;
                                                                        setNewCompanyAreas(copy);
                                                                    }}
                                                                    placeholder="Ex: Área 1"
                                                                    className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-500"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Filiais (Separadas por ponto e vírgula)</label>
                                                                <input
                                                                    type="text"
                                                                    value={area.branches.join('; ')}
                                                                    onChange={(e) => {
                                                                        const copy = [...newCompanyAreas];
                                                                        copy[index].branches = e.target.value.split(';').map(b => b.trim());
                                                                        setNewCompanyAreas(copy);
                                                                    }}
                                                                    placeholder="Ex: Filial 1; Filial 2; Matriz..."
                                                                    className="w-full border border-gray-200 rounded p-2 text-sm outline-none focus:border-blue-500"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex justify-end">
                                            <button
                                                onClick={async () => {
                                                    if (!newCompanyName.trim()) {
                                                        alert('Nome da empresa é obrigatório');
                                                        return;
                                                    }
                                                    try {
                                                        const newCompany: any = { // Using 'any' briefly to bypass potential type mismatch during quick dev, strictly typed ideally
                                                            name: newCompanyName,
                                                            cnpj: newCompanyCnpj,
                                                            logo: newCompanyLogo,
                                                            phone: newCompanyPhone,
                                                            areas: newCompanyAreas
                                                        };
                                                        const created = await createCompany(newCompany);
                                                        if (created) {
                                                            setCompanies([...companies, created]);
                                                            setNewCompanyName('');
                                                            setNewCompanyCnpj('');
                                                            setNewCompanyPhone('');
                                                            setNewCompanyLogo(null);
                                                            setNewCompanyAreas([]);
                                                            alert('Empresa cadastrada com sucesso!');
                                                        } else {
                                                            alert('Erro ao cadastrar empresa.');
                                                        }
                                                    } catch (err) {
                                                        console.error(err);
                                                        alert('Erro ao cadastrar empresa.');
                                                    }
                                                }}
                                                className="bg-green-600 hover:bg-green-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-all"
                                            >
                                                Cadastrar Empresa
                                            </button>
                                        </div>
                                    </div>

                                    {/* List of Existing Companies */}
                                    <div>
                                        <h3 className="text-sm font-bold text-gray-700 uppercase mb-4 flex items-center gap-2">
                                            <FileText size={16} /> Empresas Cadastradas
                                        </h3>
                                        <div className="space-y-3">
                                            {companies.length === 0 ? (
                                                <p className="text-sm text-gray-500 text-center py-8">Nenhuma empresa cadastrada ainda.</p>
                                            ) : (
                                                companies.map((company: any) => (
                                                    <div key={company.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex items-center justify-between">
                                                        <div className="flex items-center gap-4">
                                                            {company.logo && (
                                                                <div className="h-12 w-16 bg-white rounded border border-gray-200 flex items-center justify-center p-1">
                                                                    <img src={company.logo} alt={company.name} className="h-full w-full object-contain" />
                                                                </div>
                                                            )}
                                                            <div>
                                                                <h4 className="font-bold text-gray-800">{company.name}</h4>
                                                                {company.cnpj && <p className="text-xs text-gray-500">CNPJ: {company.cnpj}</p>}
                                                                {company.phone && <p className="text-xs text-gray-500">Tel: {company.phone}</p>}
                                                            </div>
                                                        </div>
                                                        <button
                                                            className="text-red-600 hover:text-red-800 font-semibold text-sm"
                                                        >
                                                            Excluir
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Unified Profile & Security Settings */}
                            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                                <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-3 border-b border-gray-100 pb-4">
                                    <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                        <UserIcon size={24} className={currentTheme.text} />
                                    </div>
                                    Meus Dados & Segurança
                                </h2>

                                <div className="flex flex-col md:flex-row gap-8 items-start">
                                    {/* Profile Picture Upload */}
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="relative group w-32 h-32">
                                            <div className={`w-full h-full rounded-full border-4 ${currentTheme.border} shadow-lg overflow-hidden bg-white flex items-center justify-center`}>
                                                {currentUser.photo ? (
                                                    <img src={currentUser.photo} alt="Profile" className="w-full h-full object-cover" />
                                                ) : (
                                                    <UserIcon size={64} className="text-gray-300" />
                                                )}
                                            </div>
                                            <label className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow-md border border-gray-200 cursor-pointer hover:bg-gray-50 hover:scale-110 transition-transform">
                                                <Camera size={18} className="text-gray-600" />
                                                <input type="file" className="hidden" accept="image/*" onChange={handleUserPhotoUpload} />
                                            </label>
                                        </div>
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Foto de Perfil</span>
                                    </div>

                                    <div className="flex-1 w-full space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Meu Nome</label>
                                                <input
                                                    type="text"
                                                    value={currentUser.name}
                                                    onChange={(e) => handleUpdateUserProfile('name', e.target.value)}
                                                    className={`w-full bg-white border border-gray-300 rounded-lg p-3 text-gray-900 focus:ring-2 ${currentTheme.ring} outline-none shadow-inner-light`}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Meu Telefone</label>
                                                <input
                                                    type="text"
                                                    value={currentUser.phone || ''}
                                                    onChange={(e) => handleUpdateUserProfile('phone', e.target.value)}
                                                    onBlur={handleProfilePhoneBlur}
                                                    placeholder="(00) 00000-0000"
                                                    className={`w-full bg-white border border-gray-300 rounded-lg p-3 text-gray-900 focus:ring-2 ${currentTheme.ring} outline-none shadow-inner-light ${profilePhoneError ? 'bg-red-50 border-red-500 focus:ring-red-200' : ''}`}
                                                />
                                                {profilePhoneError && <p className="text-red-500 text-xs mt-1 font-bold">{profilePhoneError}</p>}
                                            </div>
                                        </div>

                                        {/* Company, Area, and Filial Fields */}
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-6 border-t border-gray-200">
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                                                    Empresa <span className="text-red-500">*</span>
                                                </label>
                                                <select
                                                    value={currentUser.company_id || ''}
                                                    onChange={(e) => {
                                                        handleUpdateUserProfile('company_id', e.target.value);
                                                        // Reset area and filial when company changes
                                                        handleUpdateUserProfile('area', null);
                                                        handleUpdateUserProfile('filial', null);
                                                    }}
                                                    className={`w-full bg-white border border-gray-300 rounded-lg p-3 text-gray-900 focus:ring-2 ${currentTheme.ring} outline-none shadow-inner-light`}
                                                >
                                                    <option value="">-- Selecione a Empresa --</option>
                                                    {companies.map((company: any) => (
                                                        <option key={company.id} value={company.id}>{company.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Filial</label>
                                                <select
                                                    value={currentUser.filial || ''}
                                                    onChange={(e) => {
                                                        const selectedFilial = e.target.value;
                                                        handleUpdateUserProfile('filial', selectedFilial);

                                                        // Auto-populate area based on selected filial
                                                        const selectedCompany = companies.find((c: any) => c.id === currentUser.company_id);
                                                        if (selectedCompany && selectedCompany.areas) {
                                                            const areaForFilial = selectedCompany.areas.find((area: any) =>
                                                                area.branches && area.branches.includes(selectedFilial)
                                                            );
                                                            if (areaForFilial) {
                                                                handleUpdateUserProfile('area', areaForFilial.name);
                                                            }
                                                        }
                                                    }}
                                                    disabled={!currentUser.company_id}
                                                    className={`w-full bg-white border border-gray-300 rounded-lg p-3 text-gray-900 focus:ring-2 ${currentTheme.ring} outline-none shadow-inner-light ${!currentUser.company_id ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                >
                                                    <option value="">-- Selecione uma Filial --</option>
                                                    {(() => {
                                                        const selectedCompany = companies.find((c: any) => c.id === currentUser.company_id);
                                                        if (selectedCompany && selectedCompany.areas) {
                                                            const allBranches = selectedCompany.areas.flatMap((area: any) => area.branches || []);
                                                            return allBranches.map((branch: string, idx: number) => (
                                                                <option key={idx} value={branch}>{branch}</option>
                                                            ));
                                                        }
                                                        return null;
                                                    })()}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">Área</label>
                                                <input
                                                    type="text"
                                                    value={currentUser.area || ''}
                                                    readOnly
                                                    disabled
                                                    placeholder="Preenchida automaticamente"
                                                    className="w-full bg-gray-100 border border-gray-300 rounded-lg p-3 text-gray-700 cursor-not-allowed shadow-inner-light"
                                                />
                                            </div>
                                        </div>

                                        <div className="border-t border-gray-200 pt-6 mt-4">
                                            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4 flex items-center gap-2">
                                                <Lock size={16} className="text-gray-400" /> Alterar Senha (Opcional)
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Nova Senha</label>
                                                    <div className="relative">
                                                        <input
                                                            type={showNewPassword ? "text" : "password"}
                                                            value={newPassInput}
                                                            onChange={(e) => setNewPassInput(e.target.value)}
                                                            placeholder="Preencher apenas para alterar"
                                                            className={`w-full rounded-lg p-3 pr-12 outline-none shadow-inner-light transition-all ${newPassInput && confirmPassInput && newPassInput !== confirmPassInput
                                                                ? 'bg-red-50 border border-red-500 text-red-900 focus:ring-2 focus:ring-red-200'
                                                                : newPassInput && confirmPassInput && newPassInput === confirmPassInput
                                                                    ? 'bg-green-50 border border-green-500 text-gray-900 focus:ring-2 focus:ring-green-200'
                                                                    : `bg-white border border-gray-300 text-gray-900 focus:ring-2 ${currentTheme.ring}`
                                                                }`}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowNewPassword(!showNewPassword)}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                                        >
                                                            {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Confirmar Nova Senha</label>
                                                    <div className="relative">
                                                        <input
                                                            type={showConfirmNewPassword ? "text" : "password"}
                                                            value={confirmPassInput}
                                                            onChange={(e) => setConfirmPassInput(e.target.value)}
                                                            placeholder="Confirme a nova senha"
                                                            className={`w-full rounded-lg p-3 pr-12 outline-none shadow-inner-light transition-all ${newPassInput && confirmPassInput && newPassInput !== confirmPassInput
                                                                ? 'bg-red-50 border border-red-500 text-red-900 focus:ring-2 focus:ring-red-200'
                                                                : newPassInput && confirmPassInput && newPassInput === confirmPassInput
                                                                    ? 'bg-green-50 border border-green-500 text-gray-900 focus:ring-2 focus:ring-green-200'
                                                                    : `bg-white border border-gray-300 text-gray-900 focus:ring-2 ${currentTheme.ring}`
                                                                }`}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                                        >
                                                            {showConfirmNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end pt-2">
                                            <button
                                                onClick={handleSaveProfileAndSecurity}
                                                className={`${saveShake ? 'animate-shake bg-red-600' : 'bg-gray-800 hover:bg-gray-900'} text-white font-bold text-sm px-6 py-3 rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-2`}
                                            >
                                                <Save size={16} />
                                                Salvar Alterações
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Master User Management */}
                            {canManageUsers && (
                                <div id="user-management" className="bg-white rounded-2xl shadow-card border border-gray-100 p-8 mt-10">
                                    <h2 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-3 border-b border-gray-100 pb-4">
                                        <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                            <Users size={24} className={currentTheme.text} />
                                        </div>
                                        Gerenciamento de Usuários
                                    </h2>

                                    {/* Internal User Creation Form */}
                                    <div className="mb-8 bg-gray-50 p-6 rounded-xl border border-gray-200">
                                        <h3 className="text-sm font-bold text-gray-700 uppercase mb-4 flex items-center gap-2">
                                            <UserPlus size={16} /> Adicionar Novo Usuário (Interno)
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <input
                                                type="text"
                                                placeholder="Nome"
                                                value={newUserName}
                                                onChange={(e) => setNewUserName(e.target.value)}
                                                className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <input
                                                type="email"
                                                placeholder="Email"
                                                value={newUserEmail}
                                                onChange={(e) => setNewUserEmail(e.target.value)}
                                                className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                            />
                                            <div className="w-full relative">
                                                <input
                                                    type="text"
                                                    placeholder="Telefone"
                                                    value={newUserPhone}
                                                    onChange={handleInternalPhoneChange}
                                                    onBlur={handleInternalPhoneBlur}
                                                    className={`w-full bg-white border rounded-lg p-2.5 text-sm text-gray-900 outline-none ${internalPhoneError ? 'border-red-500 bg-red-50 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-500'}`}
                                                />
                                                {internalPhoneError && <p className="text-red-500 text-[10px] absolute -bottom-4 left-0 font-bold">{internalPhoneError}</p>}
                                            </div>

                                            {/* Company Selection */}
                                            <select
                                                value={newUserCompanyId}
                                                onChange={(e) => {
                                                    setNewUserCompanyId(e.target.value);
                                                    // Reset area and filial when company changes
                                                    setNewUserArea('');
                                                    setNewUserFilial('');
                                                }}
                                                className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                            >
                                                <option value="">-- Empresa (Opcional) --</option>
                                                {companies.map((company: any) => (
                                                    <option key={company.id} value={company.id}>{company.name}</option>
                                                ))}
                                            </select>

                                            {/* Filial Selection */}
                                            <select
                                                value={newUserFilial}
                                                onChange={(e) => {
                                                    const selectedFilial = e.target.value;
                                                    setNewUserFilial(selectedFilial);

                                                    // Auto-populate area based on selected filial
                                                    const selectedCompany = companies.find((c: any) => c.id === newUserCompanyId);
                                                    if (selectedCompany && selectedCompany.areas) {
                                                        const areaForFilial = selectedCompany.areas.find((area: any) =>
                                                            area.branches && area.branches.includes(selectedFilial)
                                                        );
                                                        if (areaForFilial) {
                                                            setNewUserArea(areaForFilial.name);
                                                        }
                                                    }
                                                }}
                                                disabled={!newUserCompanyId}
                                                className={`w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none ${!newUserCompanyId ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                            >
                                                <option value="">-- Filial (Opcional) --</option>
                                                {(() => {
                                                    const selectedCompany = companies.find((c: any) => c.id === newUserCompanyId);
                                                    if (selectedCompany && selectedCompany.areas) {
                                                        const allBranches = selectedCompany.areas.flatMap((area: any) => area.branches || []);
                                                        return allBranches.map((branch: string, idx: number) => (
                                                            <option key={idx} value={branch}>{branch}</option>
                                                        ));
                                                    }
                                                    return null;
                                                })()}
                                            </select>

                                            {/* Area (Read-only, auto-populated) */}
                                            <input
                                                type="text"
                                                placeholder="Área (Automático)"
                                                value={newUserArea}
                                                readOnly
                                                disabled
                                                className="w-full bg-gray-100 border border-gray-300 rounded-lg p-2.5 text-sm text-gray-700 cursor-not-allowed"
                                            />

                                            <div className="relative">
                                                <input
                                                    type={showNewUserPass ? "text" : "password"}
                                                    placeholder="Senha Provisória"
                                                    value={newUserPass}
                                                    onChange={(e) => setNewUserPass(e.target.value)}
                                                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 pr-10 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewUserPass(!showNewUserPass)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                                >
                                                    {showNewUserPass ? <EyeOff size={18} /> : <Eye size={18} />}
                                                </button>
                                            </div>
                                            {/* Added Confirmation Input */}
                                            <div className="relative">
                                                <input
                                                    type={showNewUserConfirmPass ? "text" : "password"}
                                                    placeholder="Confirmar Senha"
                                                    value={newUserConfirmPass}
                                                    onChange={(e) => setNewUserConfirmPass(e.target.value)}
                                                    className={`w-full bg-white border border-gray-300 rounded-lg p-2.5 pr-10 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none ${newUserPass && newUserConfirmPass && newUserPass !== newUserConfirmPass ? 'border-red-500 bg-red-50' : ''}`}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewUserConfirmPass(!showNewUserConfirmPass)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                                >
                                                    {showNewUserConfirmPass ? <EyeOff size={18} /> : <Eye size={18} />}
                                                </button>
                                            </div>
                                            <select
                                                value={newUserRole}
                                                onChange={(e) => setNewUserRole(e.target.value as 'MASTER' | 'ADMINISTRATIVO' | 'USER')}
                                                className="w-full border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none bg-white lg:col-span-3"
                                            >
                                                <option value="USER">Criar Perfil: Usuário Comum</option>
                                                <option value="ADMINISTRATIVO">Criar Perfil: Administrativo</option>
                                                <option value="MASTER">Criar Perfil: Administrador (Master)</option>
                                            </select>
                                        </div>
                                        <div className="mt-6 flex justify-end">
                                            <button
                                                onClick={handleCreateUserInternal}
                                                className={`${internalShake ? 'animate-shake bg-red-600' : 'bg-blue-600 hover:bg-blue-700'} text-white font-bold text-sm px-6 py-2 rounded-lg shadow-sm transition-all`}
                                            >
                                                Criar Usuário
                                            </button>
                                        </div>
                                    </div>

                                    {/* Filter Toolbar */}
                                    <div className="flex flex-col sm:flex-row gap-4 mb-6">
                                        <div className="flex items-center gap-2 flex-1">
                                            <Filter size={18} className="text-gray-400" />
                                            <span className="text-xs font-bold uppercase text-gray-500">Filtrar por:</span>
                                        </div>
                                        <select
                                            value={userFilterRole}
                                            onChange={(e) => setUserFilterRole(e.target.value as any)}
                                            className="bg-white border border-gray-300 rounded-lg text-sm p-2 text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="ALL">Todas Funções</option>
                                            <option value="MASTER">Administrador (Master)</option>
                                            <option value="ADMINISTRATIVO">Administrativo</option>
                                            <option value="USER">Usuário Comum</option>
                                        </select>
                                        <select
                                            value={userFilterStatus}
                                            onChange={(e) => setUserFilterStatus(e.target.value as any)}
                                            className="bg-white border border-gray-300 rounded-lg text-sm p-2 text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="ALL">Todos Status</option>
                                            <option value="ACTIVE">Ativo</option>
                                            <option value="PENDING">Pendente</option>
                                            <option value="BANNED">Inativo / Banido</option>
                                        </select>
                                    </div>

                                    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs text-gray-600 uppercase bg-gray-50 font-bold tracking-wider">
                                                <tr>
                                                    <th className="px-6 py-4">Nome</th>
                                                    <th className="px-6 py-4">Email</th>
                                                    <th className="px-6 py-4">Telefone</th>
                                                    <th className="px-6 py-4">Função</th>
                                                    <th className="px-6 py-4">Status</th>
                                                    <th className="px-6 py-4">Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 bg-white">
                                                {filteredUsers.map((u, idx) => (
                                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-4 font-bold text-gray-800">{u.name}</td>
                                                        <td className="px-6 py-4 text-gray-500 font-medium">{u.email}</td>
                                                        <td className="px-6 py-4 text-gray-500 font-medium">{u.phone || '-'}</td>
                                                        <td className="px-6 py-4"><span className="bg-gray-100 text-gray-600 py-1 px-3 rounded-full text-xs font-bold">{u.role}</span></td>
                                                        <td className="px-6 py-4">
                                                            {u.rejected ? (
                                                                <span className="bg-red-100 text-red-700 text-xs px-3 py-1 rounded-full font-bold shadow-sm flex w-fit items-center gap-1">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> Inativo
                                                                </span>
                                                            ) : u.approved ? (
                                                                <span className="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full font-bold shadow-sm flex w-fit items-center gap-1">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> Ativo
                                                                </span>
                                                            ) : (
                                                                <span className="bg-yellow-100 text-yellow-700 text-xs px-3 py-1 rounded-full font-bold shadow-sm flex w-fit items-center gap-1 animate-pulse">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-500"></div> Pendente
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            {u.role !== 'MASTER' && (
                                                                <div className="flex gap-2">
                                                                    {/* If Rejected, allow Revert (Unban/Approve) */}
                                                                    {u.rejected ? (
                                                                        <button
                                                                            onClick={() => updateUserStatus(u.email, true)}
                                                                            className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors font-bold text-xs flex items-center gap-1"
                                                                            title="Restaurar Acesso"
                                                                        >
                                                                            <Undo2 size={14} /> Restaurar
                                                                        </button>
                                                                    ) : !u.approved ? (
                                                                        /* Pending Users Actions */
                                                                        <>
                                                                            <button
                                                                                onClick={() => updateUserStatus(u.email, true)}
                                                                                className="px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 transition-colors font-bold text-xs flex items-center gap-1"
                                                                                title="Aprovar Usuário"
                                                                            >
                                                                                <Check size={14} /> Aprovar
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleRejectUser(u.email)}
                                                                                className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg border border-red-200 transition-colors font-bold text-xs flex items-center gap-1"
                                                                                title="Recusar e Bloquear"
                                                                            >
                                                                                <Ban size={14} /> Recusar
                                                                            </button>
                                                                        </>
                                                                    ) : (
                                                                        /* Active Users Actions */
                                                                        <button
                                                                            onClick={() => handleRejectUser(u.email)}
                                                                            className="px-3 py-1.5 bg-gray-50 text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors flex items-center gap-1 font-bold text-xs"
                                                                            title="Bloquear/Inativar Acesso"
                                                                        >
                                                                            <Ban size={14} />
                                                                            Bloquear
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {filteredUsers.length === 0 && (
                                                    <tr>
                                                        <td colSpan={6} className="px-6 py-8 text-center text-gray-400 font-medium">
                                                            Nenhum usuário encontrado com os filtros selecionados.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}



                        </div>
                    )}

                    {/* --- SUPPORT/TICKETS VIEW --- */}
                    {currentView === 'support' && (
                        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-24">
                            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                                <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-3 border-b border-gray-100 pb-4">
                                    <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                        <MessageSquareQuote size={24} className={currentTheme.text} />
                                    </div>
                                    Suporte e Melhorias
                                </h2>

                                {/* Create Ticket Form */}
                                <div className="mb-8 bg-gray-50 p-6 rounded-xl border border-gray-200">
                                    <h3 className="text-sm font-bold text-gray-700 uppercase mb-4">Relatar Problema ou Sugestão</h3>
                                    <div className="space-y-4">
                                        <input
                                            type="text"
                                            value={newTicketTitle}
                                            onChange={(e) => setNewTicketTitle(e.target.value)}
                                            placeholder="Título curto (Ex: Erro ao salvar / Sugestão de cor)"
                                            className="w-full bg-white border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <textarea
                                            value={newTicketDesc}
                                            onChange={(e) => setNewTicketDesc(e.target.value)}
                                            placeholder="Descreva detalhadamente o que aconteceu ou o que gostaria que fosse implementado..."
                                            rows={4}
                                            className="w-full bg-white border border-gray-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <div className="flex justify-between items-center">
                                            {/* Simple Image Upload for Ticket */}
                                            <div className="flex items-center gap-2">
                                                <label className="cursor-pointer flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 font-bold bg-white px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-all">
                                                    <Upload size={14} /> Anexar Imagem
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const reader = new FileReader();
                                                                reader.onloadend = () => {
                                                                    setNewTicketImages([reader.result as string]); // Valid for MVP, usually would append
                                                                };
                                                                reader.readAsDataURL(file);
                                                            }
                                                        }}
                                                    />
                                                </label>
                                                {newTicketImages.length > 0 && <span className="text-xs text-green-600 font-bold">Imagem anexada!</span>}
                                            </div>

                                            <button
                                                onClick={async () => {
                                                    if (!newTicketTitle.trim() || !newTicketDesc.trim()) {
                                                        alert('Preencha título e descrição.');
                                                        return;
                                                    }
                                                    if (!currentUser) return;

                                                    const ticket = {
                                                        title: newTicketTitle,
                                                        description: newTicketDesc,
                                                        images: newTicketImages,
                                                        user_email: currentUser.email,
                                                        user_name: currentUser.name
                                                    };
                                                    const created = await createTicket(ticket as DbTicket);
                                                    if (created) {
                                                        setTickets([created, ...tickets]);
                                                        setNewTicketTitle('');
                                                        setNewTicketDesc('');
                                                        setNewTicketImages([]);
                                                        alert('Solicitação enviada com sucesso! Obrigado.');
                                                    } else {
                                                        alert('Erro ao enviar solicitação.');
                                                    }
                                                }}
                                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-lg shadow-sm transition-all flex items-center gap-2"
                                            >
                                                <Send size={16} /> Enviar
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Ticket List */}
                                <div className="space-y-6">
                                    <h3 className="text-sm font-bold text-gray-700 uppercase flex items-center gap-2">
                                        <History size={16} /> Solicitações Recentes
                                    </h3>
                                    {tickets.length === 0 ? (
                                        <p className="text-gray-400 text-center py-8">Nenhuma solicitação encontrada.</p>
                                    ) : (
                                        tickets.map(ticket => (
                                            <div key={ticket.id} className="bg-white p-5 rounded-xl border border-gray-200 hover:border-blue-200 transition-colors shadow-sm">
                                                <div className="flex justify-between items-start mb-3">
                                                    <div>
                                                        <h4 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                                            {ticket.title}
                                                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${ticket.status === 'DONE' ? 'bg-green-100 text-green-700 border-green-200' :
                                                                ticket.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                                                    ticket.status === 'IGNORED' ? 'bg-gray-100 text-gray-500 border-gray-200' :
                                                                        'bg-yellow-100 text-yellow-700 border-yellow-200'
                                                                }`}>
                                                                {ticket.status === 'DONE' ? 'Concluído' :
                                                                    ticket.status === 'IN_PROGRESS' ? 'Em Análise' :
                                                                        ticket.status === 'IGNORED' ? 'Arquivado' : 'Aberto'}
                                                            </span>
                                                        </h4>
                                                        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                                            <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-600">
                                                                {ticket.user_name.charAt(0)}
                                                            </div>
                                                            {ticket.user_name} • {new Date(ticket.created_at || '').toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                </div>

                                                <p className="text-gray-700 text-sm whitespace-pre-wrap mb-4 bg-gray-50 p-3 rounded-lg border border-gray-100">{ticket.description}</p>

                                                {ticket.images && ticket.images.length > 0 && (
                                                    <div className="flex gap-2 mb-4">
                                                        {ticket.images.map((img, idx) => (
                                                            <img key={idx} src={img} className="h-20 w-20 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-90" onClick={() => window.open(img, '_blank')} />
                                                        ))}
                                                    </div>
                                                )}

                                                {ticket.admin_response && (
                                                    <div className="bg-green-50 p-4 rounded-lg border border-green-100 mt-4">
                                                        <p className="text-xs font-bold text-green-700 uppercase mb-1 flex items-center gap-1">
                                                            <Check size={12} /> Resposta do Desenvolvedor
                                                        </p>
                                                        <p className="text-sm text-green-900">{ticket.admin_response}</p>
                                                    </div>
                                                )}

                                                {/* Admin Actions (Master Only) */}
                                                {canRespondTickets && (
                                                    <div className="mt-4 pt-4 border-t border-gray-100">
                                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Responder / Alterar Status</label>
                                                        <div className="flex gap-2 mb-2">
                                                            <textarea
                                                                placeholder="Resposta para o usuário..."
                                                                className="w-full text-sm border border-gray-300 rounded p-2 outline-none focus:border-blue-500"
                                                                rows={2}
                                                                value={adminResponseInput[ticket.id!] || ''}
                                                                onChange={(e) => setAdminResponseInput(prev => ({ ...prev, [ticket.id!]: e.target.value }))}
                                                            />
                                                        </div>
                                                        <div className="flex gap-2 justify-end">
                                                            <button
                                                                onClick={async () => {
                                                                    const responseText = adminResponseInput[ticket.id!] || '';
                                                                    const success = await updateTicketStatus(ticket.id!, 'IN_PROGRESS', responseText);
                                                                    if (success) {
                                                                        // Optimistic Update
                                                                        setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, status: 'IN_PROGRESS', admin_response: responseText } : t));
                                                                        alert('Status alterado para "Em Análise" com sucesso!');
                                                                    } else {
                                                                        alert('Erro ao atualizar status.');
                                                                    }
                                                                }}
                                                                className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded font-bold hover:bg-blue-200"
                                                            >
                                                                Em Análise
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    const responseText = adminResponseInput[ticket.id!] || '';
                                                                    const success = await updateTicketStatus(ticket.id!, 'DONE', responseText);
                                                                    if (success) {
                                                                        setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, status: 'DONE', admin_response: responseText } : t));
                                                                        alert('Ticket concluído com sucesso!');
                                                                    } else {
                                                                        alert('Erro ao concluir ticket.');
                                                                    }
                                                                }}
                                                                className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded font-bold hover:bg-green-200"
                                                            >
                                                                Concluir
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    const responseText = adminResponseInput[ticket.id!] || '';
                                                                    const success = await updateTicketStatus(ticket.id!, 'IGNORED', responseText);
                                                                    if (success) {
                                                                        setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, status: 'IGNORED', admin_response: responseText } : t));
                                                                        alert('Ticket arquivado com sucesso!');
                                                                    } else {
                                                                        alert('Erro ao arquivar ticket.');
                                                                    }
                                                                }}
                                                                className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded font-bold hover:bg-gray-200"
                                                            >
                                                                Arquivar
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {currentView === 'access' && currentUser.role === 'MASTER' && (
                        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in relative pb-24">
                            <div className="bg-slate-950/80 rounded-[28px] border border-slate-800 shadow-2xl p-8 text-slate-50">
                                <div className="flex flex-col gap-2">
                                    <h2 className="text-2xl font-black tracking-tight uppercase">Níveis de Acesso</h2>
                                    <p className="text-sm text-slate-300">
                                        Master pode marcar caixas para conceder permissões extras aos outros níveis. O painel é referência visual de quem pode ver o quê.
                                    </p>
                                </div>

                                <div className="mt-8 grid gap-6 lg:grid-cols-3">
                                    {ACCESS_LEVELS.map(level => (
                                        <div key={level.id} className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-lg font-bold tracking-tight">{level.title}</p>
                                                    <p className="text-sm text-slate-300">
                                                        {level.description}
                                                    </p>
                                                </div>
                                                <span className={`px-3 py-1 text-[11px] uppercase rounded-full tracking-widest shadow-sm ${level.badgeClasses}`}>
                                                    {level.badgeLabel}
                                                </span>
                                            </div>

                                            <div className="space-y-3">
                                                {ACCESS_MODULES.map(module => {
                                                    const enabled = level.id === 'MASTER' ? true : accessMatrix[level.id][module.id];
                                                    return (
                                                        <div
                                                            key={`${level.id}-${module.id}`}
                                                            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-white/5 px-4 py-3 shadow-inner"
                                                        >
                                                            <div>
                                                                <p className="text-sm font-semibold text-slate-50">{module.label}</p>
                                                                {module.note && <p className="text-[11px] text-slate-400">{module.note}</p>}
                                                            </div>
                                                            {level.id === 'MASTER' ? (
                                                                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
                                                                    <Check size={14} />
                                                                </span>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleToggleAccess(level.id, module.id)}
                                                                    aria-pressed={enabled}
                                                                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border-2 transition ${enabled
                                                                        ? 'bg-orange-500 border-orange-500 text-white shadow-lg'
                                                                        : 'border-slate-600 text-slate-400 hover:border-orange-400 hover:text-orange-400'
                                                                        }`}
                                                                >
                                                                    <Check size={14} className={`transition ${enabled ? 'opacity-100' : 'opacity-0'}`} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- CHECKLIST VIEW --- */}
                    {currentView === 'checklist' && (
                        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-24">

                            {/* PENDING ITEMS ALERT BOX (Updated) */}
                            {showErrors && (currentMissingItems.length > 0 || currentSigMissing || currentUnansweredItems.length > 0) && (
                                <div ref={errorBoxRef} className="bg-white border-l-4 border-l-red-500 rounded-2xl shadow-floating overflow-hidden mb-8 animate-shake">
                                    {/* Header */}
                                    <div className="p-6 border-b border-gray-100 bg-red-50 flex items-center gap-3">
                                        <div className="p-2 bg-red-100 rounded-full text-red-600">
                                            <AlertTriangle size={24} />
                                        </div>
                                        <div>
                                            <h4 className="text-red-900 font-black text-lg uppercase tracking-wide">
                                                Pendências Encontradas
                                            </h4>
                                            <p className="text-sm text-red-700 font-medium">Você precisa resolver os itens abaixo para continuar.</p>
                                        </div>
                                    </div>

                                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Required Items (Red) */}
                                        {(currentMissingItems.length > 0 || currentSigMissing) && (
                                            <div className="space-y-3">
                                                <h5 className="text-xs font-bold uppercase tracking-widest text-red-500 mb-1 flex items-center gap-2">
                                                    <AlertCircle size={14} /> Obrigatório
                                                </h5>
                                                <ul className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                                                    {currentMissingItems.map((item, i) => (
                                                        <li key={i} className="text-sm text-red-800 bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-2">
                                                            <span><span className="font-bold">{item.section}:</span> {item.text}</span>
                                                        </li>
                                                    ))}
                                                    {currentSigMissing && (
                                                        <li className="text-sm text-red-800 bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-2">
                                                            <span className="font-bold">Assinatura do Gestor Obrigatória</span>
                                                        </li>
                                                    )}
                                                </ul>
                                            </div>
                                        )}

                                        {/* Unanswered Score Items (Yellow) */}
                                        {currentUnansweredItems.length > 0 && (
                                            <div className="space-y-3">
                                                <h5 className="text-xs font-bold uppercase tracking-widest text-yellow-500 mb-1 flex items-center gap-2">
                                                    <AlertTriangle size={14} /> Atenção (Impacta Nota)
                                                </h5>
                                                <ul className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                                                    {currentUnansweredItems.map((item, i) => (
                                                        <li key={i} className="text-sm text-yellow-800 bg-yellow-50 p-3 rounded-lg border border-yellow-100 flex items-start gap-2">
                                                            <span><span className="font-bold">{item.section}:</span> {item.text}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeChecklist.sections.map(section => {
                                const status = getSectionStatus(section);
                                return (
                                    <div key={section.id} className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
                                        <div className={`px-6 py-4 border-b border-gray-100 ${currentTheme.lightBg} flex justify-between items-center`}>
                                            <h3 className={`font-bold text-lg ${currentTheme.text}`}>{section.title}</h3>
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm">
                                                    <span className="text-xs font-bold text-gray-500">{status.answeredItems}/{status.totalItems}</span>
                                                    {/* Only show stars if the section has scoreable items */}
                                                    {status.scoreableItems > 0 && (
                                                        <div className="flex text-yellow-400">
                                                            {[1, 2, 3, 4, 5].map(star => (
                                                                <Star
                                                                    key={star}
                                                                    size={14}
                                                                    fill={star <= Math.round(status.predictedScore || 0) ? "currentColor" : "none"}
                                                                    strokeWidth={2}
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Seção</div>
                                            </div>
                                        </div>

                                        <div className="p-6 space-y-6">
                                            {section.items.map(item => {
                                                const value = getInputValue(item.id);
                                                // Updated Error Logic:
                                                const hasError = showErrors && item.required && !value; // Red
                                                const isUnanswered = showErrors && item.type === InputType.BOOLEAN_PASS_FAIL && (value === '' || value === null || value === undefined); // Yellow

                                                // Determine border class based on priority (Error > Warning > Default)
                                                let inputClasses = 'border-gray-200 bg-gray-50 text-gray-900';
                                                if (hasError) {
                                                    inputClasses = 'border-red-500 bg-red-50 text-red-900 placeholder-red-400';
                                                } else if (isUnanswered) {
                                                    inputClasses = 'border-yellow-400 bg-yellow-50 text-gray-900';
                                                }

                                                if (item.type === InputType.HEADER) {
                                                    return <h4 key={item.id} className="font-bold text-gray-800 mt-4 mb-2 border-b border-gray-100 pb-1 pt-2">{item.text}</h4>;
                                                }
                                                if (item.type === InputType.INFO) {
                                                    return <p key={item.id} className="text-sm text-gray-500 italic mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100 flex items-start gap-2"><div className="mt-0.5 min-w-4"><AlertCircle size={14} /></div>{item.text}</p>;
                                                }

                                                return (
                                                    <div key={item.id} className="mb-4">
                                                        <div className="flex justify-between mb-1.5">
                                                            <label className="block text-sm font-bold text-gray-700">{item.text} {item.required && <span className="text-red-500">*</span>}</label>
                                                            {item.helpText && <span className="text-xs text-gray-400 cursor-help" title={item.helpText}><AlertCircle size={12} /></span>}
                                                        </div>

                                                        {/* Custom rendering for Empresa field */}
                                                        {item.id === 'empresa' ? (
                                                            <select
                                                                value={value as string || ''}
                                                                onChange={(e) => {
                                                                    const selectedCompanyName = e.target.value;
                                                                    handleInputChange(item.id, selectedCompanyName);
                                                                    // Reset filial and área when empresa changes
                                                                    handleInputChange('filial', '');
                                                                    handleInputChange('area', '');

                                                                    // Bidirectional sync: Update selectedCompanyId in Settings
                                                                    const selectedCompany = companies.find((c: any) => c.name === selectedCompanyName);
                                                                    if (selectedCompany) {
                                                                        setSelectedCompanyId(selectedCompany.id);
                                                                        setEditCompanyName(selectedCompany.name);
                                                                        setEditCompanyCnpj(selectedCompany.cnpj || '');
                                                                        setEditCompanyPhone(selectedCompany.phone || '');
                                                                        setEditCompanyLogo(selectedCompany.logo || null);
                                                                        setEditCompanyAreas(selectedCompany.areas || []);
                                                                    }
                                                                }}
                                                                disabled={isReadOnly}
                                                                className={`w-full border ${inputClasses} rounded-lg p-3 focus:bg-white focus:ring-2 ${currentTheme.ring} outline-none transition-colors shadow-inner-light ${isReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                            >
                                                                <option value="">-- Selecione uma Empresa --</option>
                                                                {companies.map((company: any) => (
                                                                    <option key={company.id} value={company.name}>{company.name}</option>
                                                                ))}
                                                            </select>
                                                        ) : item.id === 'filial' ? (
                                                            /* Custom rendering for Filial field */
                                                            <select
                                                                value={value as string || ''}
                                                                onChange={(e) => {
                                                                    const selectedFilial = e.target.value;
                                                                    handleInputChange(item.id, selectedFilial);

                                                                    // Auto-populate área based on selected filial
                                                                    const empresaValue = getInputValue('empresa');
                                                                    const selectedCompany = companies.find((c: any) => c.name === empresaValue);
                                                                    if (selectedCompany && selectedCompany.areas) {
                                                                        const areaForFilial = selectedCompany.areas.find((area: any) =>
                                                                            area.branches && area.branches.includes(selectedFilial)
                                                                        );
                                                                        if (areaForFilial) {
                                                                            handleInputChange('area', areaForFilial.name);
                                                                        }
                                                                    }
                                                                }}
                                                                disabled={isReadOnly || !getInputValue('empresa')}
                                                                className={`w-full border ${inputClasses} rounded-lg p-3 focus:bg-white focus:ring-2 ${currentTheme.ring} outline-none transition-colors shadow-inner-light ${isReadOnly || !getInputValue('empresa') ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                            >
                                                                <option value="">-- Selecione uma Filial --</option>
                                                                {(() => {
                                                                    const empresaValue = getInputValue('empresa');
                                                                    const selectedCompany = companies.find((c: any) => c.name === empresaValue);
                                                                    if (selectedCompany && selectedCompany.areas) {
                                                                        // Flatten all branches from all areas
                                                                        const allBranches = selectedCompany.areas.flatMap((area: any) => area.branches || []);
                                                                        return allBranches.map((branch: string, idx: number) => (
                                                                            <option key={idx} value={branch}>{branch}</option>
                                                                        ));
                                                                    }
                                                                    return null;
                                                                })()}
                                                            </select>
                                                        ) : item.id === 'area' ? (
                                                            /* Custom rendering for Área field - Read-only, auto-populated */
                                                            <input
                                                                type="text"
                                                                value={value as string || ''}
                                                                readOnly
                                                                disabled
                                                                className="w-full border border-gray-200 bg-gray-100 text-gray-700 rounded-lg p-3 cursor-not-allowed shadow-inner-light"
                                                                placeholder="Área será preenchida automaticamente"
                                                            />
                                                        ) : item.type === InputType.TEXT && (
                                                            /* Standard TEXT input for other fields */
                                                            <input
                                                                type="text"
                                                                value={value as string || ''}
                                                                onChange={(e) => handleInputChange(item.id, e.target.value)}
                                                                disabled={isReadOnly}
                                                                readOnly={isReadOnly}
                                                                className={`w-full border ${inputClasses} rounded-lg p-3 focus:bg-white focus:ring-2 ${currentTheme.ring} outline-none transition-colors shadow-inner-light ${isReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                            />
                                                        )}
                                                        {item.type === InputType.TEXTAREA && (
                                                            <textarea
                                                                value={value as string || ''}
                                                                onChange={(e) => handleInputChange(item.id, e.target.value)}
                                                                disabled={isReadOnly}
                                                                readOnly={isReadOnly}
                                                                rows={3}
                                                                className={`w-full border ${inputClasses} rounded-lg p-3 focus:bg-white focus:ring-2 ${currentTheme.ring} outline-none transition-colors shadow-inner-light ${isReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                            />
                                                        )}
                                                        {item.type === InputType.DATE && (
                                                            <DateInput value={value as string || ''} onChange={(val) => handleInputChange(item.id, val)} theme={currentTheme} hasError={hasError} disabled={isReadOnly} />
                                                        )}
                                                        {item.type === InputType.BOOLEAN_PASS_FAIL && (
                                                            <div className="flex gap-2 sm:gap-3">
                                                                <button
                                                                    onClick={() => handleInputChange(item.id, 'pass')}
                                                                    disabled={isReadOnly}
                                                                    className={`flex-1 py-2.5 sm:py-3 rounded-xl border font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${value === 'pass' ? 'bg-green-500 text-white border-green-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                                >
                                                                    <Check size={14} className="sm:w-4 sm:h-4" /> <span className="tracking-wide">CONFORME</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleInputChange(item.id, 'fail')}
                                                                    disabled={isReadOnly}
                                                                    className={`flex-1 py-2.5 sm:py-3 rounded-xl border font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${value === 'fail' ? 'bg-red-500 text-white border-red-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                                >
                                                                    <AlertTriangle size={14} className="sm:w-4 sm:h-4" /> <span className="tracking-wide">NÃO CONFORME</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleInputChange(item.id, 'na')}
                                                                    disabled={isReadOnly}
                                                                    className={`w-14 sm:w-16 py-2.5 sm:py-3 rounded-xl border font-bold text-xs sm:text-sm transition-all ${value === 'na' ? 'bg-gray-600 text-white border-gray-700' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                                >
                                                                    N/A
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Image Upload - Hide for info_basica */}
                                            {section.id !== 'info_basica' && (
                                                <div className="mt-8 pt-6 border-t border-gray-100">
                                                    <label className="flex items-center gap-2 text-sm font-bold text-gray-700 uppercase mb-4">
                                                        <ImageIcon size={16} />
                                                        Fotos e Evidências
                                                    </label>
                                                    <div className="flex flex-wrap gap-4">
                                                        {(getDataSource(activeChecklistId).imgs[section.id] || []).map((img, idx) => (
                                                            <div key={idx} className="relative w-28 h-28 rounded-xl overflow-hidden border border-gray-200 shadow-sm group">
                                                                <img src={img} className="w-full h-full object-cover" />
                                                                {!isReadOnly && (
                                                                    <button onClick={() => removeImage(section.id, idx)} className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-all shadow-sm hover:bg-red-700"><Trash2 size={12} /></button>
                                                                )}
                                                            </div>
                                                        ))}

                                                        {/* Camera Button - Only for MASTER */}
                                                        {!isReadOnly && (
                                                            <>
                                                                <label className={`w-28 h-28 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:bg-white hover:border-blue-400 hover:text-blue-600 text-gray-400 transition-all bg-gray-50`}>
                                                                    <Camera size={24} />
                                                                    <span className="text-[10px] font-bold mt-2 uppercase tracking-wide text-center px-1">Câmera</span>
                                                                    {/* capture="environment" forces camera on mobile */}
                                                                    <input type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => handleImageUpload(section.id, e)} />
                                                                </label>

                                                                {/* Gallery Upload Button */}
                                                                <label className={`w-28 h-28 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:bg-white hover:border-gray-400 hover:text-gray-600 text-gray-400 transition-all bg-gray-50`}>
                                                                    <Upload size={24} />
                                                                    <span className="text-[10px] font-bold mt-2 uppercase tracking-wide text-center px-1">Galeria</span>
                                                                    {/* Standard upload */}
                                                                    <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(section.id, e)} />
                                                                </label>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Signatures - Only for MASTER */}
                            {!isReadOnly && (
                                <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                                    <h3 className="font-bold text-lg text-gray-800 mb-6 flex items-center gap-2">
                                        <FileCheck className={currentTheme.text} />
                                        Assinatura e Validação
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div data-signature="gestor">
                                            <SignaturePad
                                                label="Assinatura do Gestor"
                                                onEnd={(data) => handleSignature('gestor', data)}
                                            />
                                        </div>
                                        <div data-signature="coordenador">
                                            <SignaturePad
                                                label="Assinatura Coordenador / Aplicador"
                                                onEnd={(data) => handleSignature('coordenador', data)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Next Step Navigation - Only for MASTER */}
                            {!isReadOnly && (
                                <div className="flex flex-col sm:flex-row justify-between pt-4 gap-4">
                                    <button
                                        onClick={handleVerify}
                                        className="px-6 py-4 rounded-xl font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                                    >
                                        <CheckSquareIcon size={20} className="text-red-500" />
                                        Verificar Pendências
                                    </button>

                                    <div className="flex gap-4">
                                        <button
                                            onClick={() => handleViewChange('summary')}
                                            className="px-6 py-4 rounded-xl font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                                        >
                                            Pular para Finalização
                                        </button>

                                        <button
                                            onClick={handleNextChecklist}
                                            className={`px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3 ${currentTheme.button}`}
                                        >
                                            {checklists.findIndex(c => c.id === activeChecklistId) < checklists.length - 1 ? (
                                                <>Próximo Checklist <ChevronRight size={20} /></>
                                            ) : (
                                                <>Revisar e Finalizar <CheckCircle size={20} /></>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- SUMMARY VIEW --- */}
                    {currentView === 'summary' && (
                        <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-24">
                            {checklists.map(cl => {
                                const stats = getChecklistStats(cl.id);
                                const isIgnored = ignoredChecklists.has(cl.id);
                                const isComplete = isChecklistComplete(cl.id);
                                const percentPassed = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;
                                const percentFailed = 100 - percentPassed;

                                // Animations for score
                                const isPerfect = stats.score === 5;
                                const isGood = stats.score >= 4;
                                const isBad = stats.score < 3;

                                // IF INCOMPLETE AND NOT IGNORED, SHOW "CONTINUE FILLING" CARD STYLE
                                if (!isComplete && !isIgnored) {
                                    return (
                                        <div key={cl.id} className="bg-white rounded-2xl shadow-card border p-6 md:p-8 flex flex-col gap-6 transition-all border-gray-100 hover:shadow-lg">
                                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                                <div className="flex-1">
                                                    <h3 className="font-bold text-gray-800 text-xl flex items-center gap-2">
                                                        {cl.title}
                                                    </h3>
                                                    <p className="text-sm text-gray-500 mt-1">{cl.description}</p>
                                                </div>
                                                <div className="flex items-center gap-4 w-full md:w-auto">
                                                    <button
                                                        onClick={() => toggleIgnoreChecklist(cl.id)}
                                                        className="text-xs font-bold text-gray-400 hover:text-gray-600 uppercase tracking-wider"
                                                    >
                                                        Não se Aplica
                                                    </button>
                                                    <button
                                                        onClick={() => { setActiveChecklistId(cl.id); handleViewChange('checklist'); }}
                                                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
                                                    >
                                                        Continuar Preenchimento
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="space-y-6">
                                                <div>
                                                    <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                                                        <span>Conformidade</span>
                                                        <span>{Math.round(percentPassed)}%</span>
                                                    </div>
                                                    <div className="h-4 w-full bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
                                                        <div style={{ width: `${percentPassed}%` }} className="h-full bg-green-500 transition-all duration-1000 ease-out"></div>
                                                        <div style={{ width: `${percentFailed}%` }} className="h-full bg-red-500 transition-all duration-1000 ease-out"></div>
                                                    </div>
                                                </div>

                                                {/* Show missing items if any */}
                                                {stats.missingItems.length > 0 && (
                                                    <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="p-1.5 bg-yellow-200 rounded-full text-yellow-700"><AlertCircle size={16} /></div>
                                                            <span className="font-bold text-yellow-800 text-sm uppercase">Pendências (Obrigatório)</span>
                                                        </div>
                                                        <ul className="space-y-2 mt-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                                            {stats.missingItems.map((miss, i) => (
                                                                <li key={i} className="text-xs text-yellow-700 bg-white/50 p-2 rounded border border-yellow-100 flex items-start gap-2">
                                                                    <div className="mt-0.5 min-w-3"><AlertTriangle size={12} /></div>
                                                                    <span><strong className="block text-yellow-800 opacity-70 mb-0.5">{miss.section}</strong> {miss.text}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="p-1.5 bg-green-200 rounded-full text-green-700"><Check size={16} /></div>
                                                            <span className="font-bold text-green-800 text-sm uppercase">Itens Conformes</span>
                                                        </div>
                                                        <div className="text-3xl font-black text-green-700">{stats.passed} <span className="text-sm font-medium text-green-600 opacity-70">/ {stats.total}</span></div>
                                                    </div>
                                                    <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="p-1.5 bg-red-200 rounded-full text-red-700"><AlertTriangle size={16} /></div>
                                                            <span className="font-bold text-red-800 text-sm uppercase">Itens Não Conformes</span>
                                                        </div>
                                                        {stats.failedItems.length > 0 ? (
                                                            <div className="mt-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                                                <ul className="space-y-2">
                                                                    {stats.failedItems.map((fail, i) => (
                                                                        <li key={i} className="text-xs text-red-700 bg-white/50 p-2 rounded border border-red-100 flex items-start gap-2">
                                                                            <div className="mt-0.5 min-w-3"><X size={12} /></div>
                                                                            <span><strong className="block text-red-800 opacity-70 mb-0.5">{fail.section}</strong> {fail.text}</span>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        ) : (
                                                            <div className="text-3xl font-black text-green-600/50 flex items-center gap-2">
                                                                0
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }

                                // STANDARD COMPLETE/IGNORED CARD
                                return (
                                    <div key={cl.id} className={`bg-white rounded-2xl shadow-card border p-6 md:p-8 flex flex-col gap-6 transition-all ${isIgnored ? 'opacity-60 border-gray-200 grayscale' : 'border-gray-100 hover:shadow-lg'}`}>
                                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                            <div className="flex-1">
                                                <h3 className="font-bold text-gray-800 text-xl flex items-center gap-2">
                                                    {cl.title}
                                                    {isComplete && !isIgnored && <CheckCircle size={20} className="text-green-500" />}
                                                </h3>
                                                <p className="text-sm text-gray-500 mt-1">{cl.description}</p>
                                            </div>
                                            <div className="flex items-center gap-4 w-full md:w-auto">
                                                <button onClick={() => toggleIgnoreChecklist(cl.id)} className="text-xs font-bold text-gray-400 hover:text-gray-600 uppercase tracking-wider">
                                                    {isIgnored ? 'Incluir na Avaliação' : 'Não se Aplica'}
                                                </button>
                                                {!isIgnored && !isComplete && (
                                                    <button
                                                        onClick={() => { setActiveChecklistId(cl.id); handleViewChange('checklist'); }}
                                                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
                                                    >
                                                        Continuar Preenchimento
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {!isIgnored && (
                                            <div className="space-y-6">
                                                {/* Visual Score Bar */}
                                                <div>
                                                    <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                                                        <span>Conformidade</span>
                                                        <span>{Math.round(percentPassed)}%</span>
                                                    </div>
                                                    <div className="h-4 w-full bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
                                                        <div style={{ width: `${percentPassed}%` }} className={`h-full bg-green-500 transition-all duration-1000 ease-out`}></div>
                                                        <div style={{ width: `${percentFailed}%` }} className={`h-full bg-red-500 transition-all duration-1000 ease-out`}></div>
                                                    </div>
                                                </div>

                                                {/* Detailed Breakdown Grid */}
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {/* Passed Items */}
                                                    <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="p-1.5 bg-green-200 rounded-full text-green-700"><Check size={16} /></div>
                                                            <span className="font-bold text-green-800 text-sm uppercase">Itens Conformes</span>
                                                        </div>
                                                        <div className="text-3xl font-black text-green-700">{stats.passed} <span className="text-sm font-medium text-green-600 opacity-70">/ {stats.total}</span></div>
                                                    </div>

                                                    {/* Failed Items List */}
                                                    <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="p-1.5 bg-red-200 rounded-full text-red-700"><AlertTriangle size={16} /></div>
                                                            <span className="font-bold text-red-800 text-sm uppercase">Itens Não Conformes</span>
                                                        </div>
                                                        {stats.failedItems.length > 0 ? (
                                                            <div className="mt-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                                                <ul className="space-y-2">
                                                                    {stats.failedItems.map((fail, i) => (
                                                                        <li key={i} className="text-xs text-red-700 bg-white/50 p-2 rounded border border-red-100 flex items-start gap-2">
                                                                            <div className="mt-0.5 min-w-3"><X size={12} /></div>
                                                                            <span><strong className="block text-red-800 opacity-70 mb-0.5">{fail.section}</strong> {fail.text}</span>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        ) : (
                                                            <div className="text-3xl font-black text-green-600/50 flex items-center gap-2">
                                                                0 <span className="text-sm font-bold text-green-600/50 uppercase">Tudo certo!</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Star Rating Display */}
                                                <div className="flex items-center justify-center p-4 bg-gray-50 rounded-xl border border-gray-100 gap-6">
                                                    <div className="text-right">
                                                        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Nota Parcial</div>
                                                        <div className="text-3xl font-black text-gray-800 leading-none">{stats.score.toFixed(1)}</div>
                                                    </div>
                                                    <div className="flex gap-1">
                                                        {[1, 2, 3, 4, 5].map(star => (
                                                            <Star
                                                                key={star}
                                                                size={32}
                                                                className={`${isPerfect ? 'animate-bounce' : ''} transition-all`}
                                                                fill={star <= Math.round(stats.score) ? "#FBBF24" : "none"}
                                                                color={star <= Math.round(stats.score) ? "#FBBF24" : "#D1D5DB"}
                                                                strokeWidth={2}
                                                            />
                                                        ))}
                                                    </div>
                                                    <div className="text-left">
                                                        {isPerfect && <PartyPopper className="text-yellow-500 animate-pulse" size={32} />}
                                                        {isGood && !isPerfect && <Trophy className="text-blue-500" size={32} />}
                                                        {isBad && <Frown className="text-red-500" size={32} />}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8 mt-8 sticky bottom-4 z-20">
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-gray-800">Resultado Final</h2>
                                        <p className="text-sm text-gray-500">Média global de todos os checklists ativos.</p>
                                    </div>
                                    <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">{calculateGlobalScore()}</div>
                                </div>
                                <div className="flex justify-end border-t border-gray-100 pt-6">
                                    <button
                                        onClick={handleFinalizeAndSave}
                                        disabled={isSaving}
                                        className={`px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-200 flex items-center gap-2 ${isSaving ? 'opacity-70 cursor-wait' : ''}`}
                                    >
                                        {isSaving ? (
                                            <>
                                                <Loader2 size={24} className="animate-spin" />
                                                <span>SALVANDO AGUARDE...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Save size={20} />
                                                <span>FINALIZAR E SALVAR RELATÓRIO</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- REPORT / HISTORY VIEW (READ ONLY) --- */}
                    {(currentView === 'report' || currentView === 'view_history') && (
                        <div className="max-w-5xl mx-auto bg-white p-6 shadow-2xl rounded-3xl min-h-screen">
                            <LogoPrint config={displayConfig} theme={currentTheme} />

                            {/* Basic Info Block (Extracted Top) */}
                            <div className="mb-4 pb-3">
                                <h3 className={`text-lg font-black uppercase tracking-tight mb-3 pb-1 border-b-2 ${currentTheme.border} ${currentTheme.text}`}>Informações Básicas</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Empresa</p>
                                        <p className="text-lg font-bold text-gray-800">{getInputValue('empresa', basicInfoSourceChecklist) || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Área</p>
                                        <p className="text-lg font-bold text-gray-800">{getInputValue('area', basicInfoSourceChecklist) || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Filial</p>
                                        <p className="text-lg font-bold text-gray-800">{getInputValue('filial', basicInfoSourceChecklist) || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Nome do Coordenador / Aplicador</p>
                                        <p className="text-lg font-bold text-gray-800">{getInputValue('nome_coordenador', basicInfoSourceChecklist) || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Gestor(a)</p>
                                        <p className="text-lg font-bold text-gray-800">{getInputValue('gestor', basicInfoSourceChecklist) || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Data de Aplicação</p>
                                        <p className="text-lg font-bold text-gray-800">{getInputValue('data_aplicacao', basicInfoSourceChecklist) || '-'}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-4 border-b-2 border-gray-100 pb-3">
                                <div>
                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Responsável pela Avaliação (Sistema)</p>
                                    <p className="text-lg font-bold text-gray-800">{viewHistoryItem ? viewHistoryItem.userName : currentUser.name}</p>
                                    <p className="text-sm text-gray-500">{viewHistoryItem ? viewHistoryItem.userEmail : currentUser.email}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Data do Relatório</p>
                                    <p className="text-lg font-bold text-gray-800">
                                        {new Date(viewHistoryItem ? viewHistoryItem.date : new Date().toISOString()).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {new Date(viewHistoryItem ? viewHistoryItem.date : new Date().toISOString()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>

                            {/* Interactive Score Feedback */}
                            {(() => {
                                const scoreNum = Number(viewHistoryItem ? viewHistoryItem.score : calculateGlobalScore());
                                const feedback = getScoreFeedback(scoreNum);

                                return (
                                    <div className="flex flex-col items-center justify-center p-3 bg-gray-50 rounded-xl border border-gray-200 mb-4 text-center">
                                        <span className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Nota Global</span>
                                        <div className="flex items-center gap-4 mb-2">
                                            {feedback.icon}
                                            <span className={`text-6xl font-black ${feedback.color}`}>{scoreNum.toFixed(1)}</span>
                                        </div>
                                        <span className={`px-4 py-1 rounded-full text-sm font-bold uppercase tracking-wide mb-2 ${feedback.bg} ${feedback.color}`}>
                                            {feedback.label}
                                        </span>
                                        {scoreNum >= 3.0 && <p className="text-sm font-bold text-gray-500 animate-pulse">{feedback.msg}</p>}
                                        <span className="block text-xs font-bold text-gray-400 mt-2">de 5.0</span>
                                    </div>
                                );
                            })()}

                            <div className="space-y-4">
                                {checklists.map(cl => {
                                    const isIgnored = viewHistoryItem ? viewHistoryItem.ignoredChecklists.includes(cl.id) : ignoredChecklists.has(cl.id);
                                    if (isIgnored) return null;

                                    return (
                                        <div key={cl.id} className="break-inside-avoid">
                                            <h3 className={`text-lg font-black uppercase tracking-tight mb-3 pb-1 border-b-2 ${currentTheme.border} ${currentTheme.text}`}>{cl.title}</h3>
                                            <div className="space-y-3">
                                                {cl.sections.map(sec => {
                                                    // SKIP INFO BASICA IN INDIVIDUAL SECTIONS (Already shown at top)
                                                    if (sec.id === 'info_basica') return null;

                                                    return (
                                                        <div key={sec.id} className="mb-3">
                                                            <h4 className="font-bold text-gray-800 mb-2 uppercase text-xs tracking-wide bg-gray-100 p-1 pl-3 rounded-lg">{sec.title}</h4>
                                                            <div className="pl-3 space-y-2">
                                                                {sec.items.map(item => {
                                                                    const val = getInputValue(item.id, cl.id);
                                                                    if (item.type === InputType.HEADER) return <h5 key={item.id} className="font-bold text-gray-700 mt-4 border-b border-gray-200">{item.text}</h5>;
                                                                    if (item.type === InputType.INFO) return null; // Skip info in print

                                                                    return (
                                                                        <div key={item.id} className="flex justify-between items-start text-sm border-b border-gray-50 pb-2 last:border-0">
                                                                            <span className="w-2/3 pr-4 text-gray-700">{item.text}</span>
                                                                            <span className="font-bold">
                                                                                {item.type === InputType.BOOLEAN_PASS_FAIL ? (
                                                                                    val === 'pass' ? <span className="text-green-600">CONFORME</span> :
                                                                                        val === 'fail' ? <span className="text-red-600">NÃO CONFORME</span> :
                                                                                            val === 'na' ? <span className="text-gray-400">N/A</span> : '-'
                                                                                ) : (
                                                                                    val || '-'
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                            {/* Images in Report */}
                                                            {(getDataSource(cl.id).imgs[sec.id] || []).length > 0 && (
                                                                <div className="mt-2 mb-2 grid grid-cols-2 gap-2 break-inside-avoid page-break-inside-avoid" style={{ pageBreakInside: 'avoid' }}>
                                                                    {(getDataSource(cl.id).imgs[sec.id] || []).slice(0, 2).map((img, idx) => (
                                                                        <div key={idx} className="report-image-container rounded-lg border border-gray-300 bg-white p-1 break-inside-avoid" style={{ height: '200px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                                                                            <img src={img} alt={`Imagem ${idx + 1}`} className="w-full h-full object-contain" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                            {/* Signatures in Report */}
                                            <div className="mt-4 flex justify-end gap-4">
                                                {getDataSource(cl.id).sigs['gestor'] && (
                                                    <div className="text-center">
                                                        <img src={getDataSource(cl.id).sigs['gestor']} className="h-16 mb-1 border-b border-gray-300" />
                                                        <p className="text-xs font-bold text-gray-500 uppercase">Assinatura Gestor</p>
                                                    </div>
                                                )}
                                                {getDataSource(cl.id).sigs['coordenador'] && (
                                                    <div className="text-center">
                                                        <img src={getDataSource(cl.id).sigs['coordenador']} className="h-16 mb-1 border-b border-gray-300" />
                                                        <p className="text-xs font-bold text-gray-500 uppercase">Assinatura Coordenador</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="mt-6 flex justify-center no-print">
                                <button
                                    onClick={handleDownloadPDF}
                                    className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-3 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 font-bold"
                                >
                                    <Download size={20} />
                                    Baixar Relatório em PDF
                                </button>
                            </div>
                        </div>
                    )}

                    {/* --- HISTORY LIST VIEW --- */}
                    {currentView === 'history' && (
                        <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-24">
                            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                            <History size={24} className={currentTheme.text} />
                                        </div>
                                        Histórico de Avaliações
                                    </h2>

                                    <button
                                        onClick={handleReloadReports}
                                        disabled={isReloadingReports}
                                        className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors text-white ${isReloadingReports ? 'bg-blue-400 hover:bg-blue-400 cursor-wait opacity-80' : 'bg-blue-500 hover:bg-blue-600'
                                            }`}
                                        title="Recarregar relatórios do Supabase"
                                    >
                                        {isReloadingReports ? (
                                            <>
                                                <svg
                                                    className="w-4 h-4 animate-spin"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                    />
                                                </svg>
                                                Atualizando…
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                                Atualizar
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* Filters for Master */}
                                {canModerateHistory && (
                                    <div className="mb-6 flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
                                        <Filter size={18} className="text-gray-400" />
                                        <span className="text-sm font-bold text-gray-600">Filtrar Usuário:</span>
                                        <select
                                            value={historyFilterUser}
                                            onChange={(e) => setHistoryFilterUser(e.target.value)}
                                            className="bg-white border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="all">Todos os Usuários</option>
                                            {Array.from(new Set(reportHistory.map(r => r.userEmail))).map(email => (
                                                <option key={email} value={email}>{users.find(u => u.email === email)?.name || email}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-xs text-gray-500 uppercase bg-gray-50 font-bold tracking-wider">
                                            <tr>
                                                <th className="px-6 py-4">Data</th>
                                                <th className="px-6 py-4">Empresa Avaliada</th>
                                                <th className="px-6 py-4">Área</th>
                                                <th className="px-6 py-4">Filial Avaliada</th>
                                                <th className="px-6 py-4">Gestor(a)</th>
                                                <th className="px-6 py-4">Responsável</th>
                                                <th className="px-6 py-4">Nota</th>
                                                <th className="px-6 py-4 text-right">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {getFilteredHistory().length === 0 ? (
                                                <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">Nenhum relatório encontrado.</td></tr>
                                            ) : (
                                                getFilteredHistory().map(report => (
                                                    <tr key={report.id} className="hover:bg-gray-50 transition-colors group">
                                                        <td className="px-6 py-4 font-medium text-gray-700">
                                                            {new Date(report.date).toLocaleDateString('pt-BR')} <span className="text-gray-400 text-xs ml-1">{new Date(report.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </td>
                                                        <td className="px-6 py-4 font-bold text-gray-800">
                                                            {report.empresa_avaliada || '-'}
                                                        </td>
                                                        <td className="px-6 py-4 text-gray-700">
                                                            {report.area || '-'}
                                                        </td>
                                                        <td className="px-6 py-4 font-bold text-gray-800">
                                                            {report.filial || '-'}
                                                        </td>
                                                        <td className="px-6 py-4 text-gray-700">
                                                            {report.gestor || '-'}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div>{report.userName}</div>
                                                            <div className="text-xs text-gray-400">{report.userEmail}</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${Number(report.score) >= 4.0 ? 'bg-green-100 text-green-700' : Number(report.score) >= 3.0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                                                {report.score}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right flex justify-end gap-2">
                                                            <button onClick={() => handleViewHistoryItem(report)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Visualizar">
                                                                <Eye size={18} />
                                                            </button>
                                                            {/* ONLY MASTER CAN DELETE */}
                                                            {canModerateHistory && (
                                                                <button onClick={() => handleDeleteHistoryItem(report.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Excluir">
                                                                    <Trash2 size={18} />
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                            <Package size={24} className={currentTheme.text} />
                                        </div>
                                        Histórico de Conferências de Estoque
                                    </h2>
                                </div>
                                {stockConferenceHistory.length === 0 ? (
                                    <div className="text-center py-12 text-sm text-gray-500">
                                        Nenhuma conferência de estoque registrada ainda.
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="space-y-4 border-b border-gray-100 pb-4">
                                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <Filter size={16} className="text-gray-400" />
                                                    <span className="font-semibold text-gray-700">Filtrar conferências</span>
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Mostrando {filteredStockConferenceHistory.length} de {stockConferenceHistory.length} conferência(s)
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="text-[10px] uppercase tracking-widest text-gray-400">Filiais</div>
                                                <div className="flex flex-wrap gap-2">
                                                    {stockConferenceBranchOptions.map(option => (
                                                        <button
                                                            key={option.key}
                                                            type="button"
                                                            onClick={() => toggleStockBranchFilter(option.key)}
                                                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${stockBranchFilters.includes(option.key) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    ))}
                                                    {stockBranchFilters.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={handleResetStockBranchFilters}
                                                            className="px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs text-gray-500 hover:bg-gray-50 transition"
                                                        >
                                                            Limpar
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <span className="text-[10px] uppercase tracking-widest text-gray-400">Área</span>
                                                <select
                                                    value={stockAreaFilter}
                                                    onChange={(e) => handleStockAreaFilterChange(e.target.value)}
                                                    className="ml-0 w-full max-w-xs text-sm rounded-xl border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                >
                                                    <option value="all">Todas as Áreas</option>
                                                    {stockConferenceAreaOptions.map(option => (
                                                        <option key={option.key} value={option.key}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        {filteredStockConferenceHistory.length === 0 ? (
                                            <div className="text-center py-12 text-sm text-gray-500">
                                                Nenhuma conferência de estoque encontrada com os filtros aplicados.
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                {filteredStockConferenceHistory.map(item => {
                                                    const createdDate = new Date(item.createdAt);
                                                    return (
                                                        <div key={item.id} className="border border-gray-100 rounded-2xl p-4 shadow-sm bg-white">
                                                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                                                <div>
                                                                    <p className="text-xs uppercase tracking-widest text-gray-400">Filial</p>
                                                                    <p className="text-base font-bold text-gray-800">{item.branch}</p>
                                                                    <p className="text-sm text-gray-600 mt-1">Área: {item.area}</p>
                                                                    <p className="text-xs text-gray-500 mt-1">
                                                                        {createdDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })} às {createdDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                                    </p>
                                                                </div>
                                                                <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-[11px] font-bold">
                                                                    {Math.round(item.percent)}% concluído
                                                                </div>
                                                            </div>
                                                            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
                                                                <div className="bg-gray-50 rounded-xl py-3 border border-gray-100">
                                                                    <p className="text-[10px] uppercase text-gray-400">Total</p>
                                                                    <p className="text-lg font-bold text-gray-800">{item.total}</p>
                                                                </div>
                                                                <div className="bg-green-50 rounded-xl py-3 border border-green-100">
                                                                    <p className="text-[10px] uppercase text-green-500">Corretos</p>
                                                                    <p className="text-lg font-bold text-green-700">{item.matched}</p>
                                                                </div>
                                                                <div className="bg-red-50 rounded-xl py-3 border border-red-100">
                                                                    <p className="text-[10px] uppercase text-red-500">Divergentes</p>
                                                                    <p className="text-lg font-bold text-red-600">{item.divergent}</p>
                                                                </div>
                                                                <div className="bg-yellow-50 rounded-xl py-3 border border-yellow-100">
                                                                    <p className="text-[10px] uppercase text-yellow-600">Pendente</p>
                                                                    <p className="text-lg font-bold text-yellow-700">{item.pending}</p>
                                                                </div>
                                                            </div>
                                                            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-gray-500">
                                                                <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200">Responsável: {item.userName}</span>
                                                                <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200">Farmacêutico: {item.pharmacist}</span>
                                                                <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200">Gestor: {item.manager}</span>
                                                            </div>
                                                            <div className="mt-4 flex justify-end">
                                                                <button
                                                                    onClick={() => handleViewStockConferenceReport(item.id)}
                                                                    className="flex items-center gap-2 rounded-2xl px-4 py-2 bg-blue-600 text-white text-sm font-bold shadow-lg hover:bg-blue-700 transition"
                                                                >
                                                                    <FileText size={16} />
                                                                    Ver Conferência
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {viewingStockConferenceReport && (
                        <StockConferenceReportViewer
                            report={viewingStockConferenceReport}
                            onClose={() => setViewingStockConferenceReport(null)}
                        />
                    )}

                    {editingChecklistDefinition && (
                        <div className="fixed inset-0 z-[80] flex items-end justify-center px-4 pt-10 pb-10 lg:pt-12 lg:pb-16">
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeChecklistEditor} />
                            <div className="relative z-10 w-full max-w-4xl lg:max-w-[calc(100vw-20rem)] bg-white rounded-3xl shadow-2xl border border-gray-100 p-6 overflow-y-auto max-h-[calc(100vh-9rem)] lg:ml-[18rem]">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Editar Checklist</p>
                                        <h3 className="text-xl font-bold text-gray-900">{editingChecklistDefinition.title}</h3>
                                        <p className="text-sm text-gray-500">{editingChecklistDefinition.description}</p>
                                    </div>
                                    <button
                                        onClick={closeChecklistEditor}
                                        className="text-gray-500 hover:text-gray-900 rounded-full p-2 transition"
                                        aria-label="Fechar edição"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                                <div className="mt-6 space-y-5">
                                    {editingChecklistDefinition.sections.map(section => (
                                        <div key={section.id} className="bg-gray-50 rounded-2xl border border-gray-200 p-4 space-y-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <input
                                                    value={section.title}
                                                    onChange={(e) => handleSectionTitleChange(section.id, e.target.value)}
                                                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                                                />
                                                <button
                                                    onClick={() => handleRemoveSection(section.id)}
                                                    className="text-red-600 text-xs font-bold uppercase tracking-widest"
                                                >
                                                    Remover seção
                                                </button>
                                            </div>
                                            <div className="space-y-3">
                                                {section.items.map(item => (
                                                    <div key={item.id} className="grid gap-2 lg:grid-cols-[2fr,1fr,1fr] items-center">
                                                        <input
                                                            value={item.text}
                                                            onChange={(e) => handleItemTextChange(section.id, item.id, e.target.value)}
                                                            className="col-span-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                                                        />
                                                        <select
                                                            value={item.type}
                                                            onChange={(e) => handleItemTypeChange(section.id, item.id, e.target.value as InputType)}
                                                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                                                        >
                                                            {Object.values(InputType).map(typeValue => (
                                                                <option key={typeValue} value={typeValue}>
                                                                    {INPUT_TYPE_LABELS[typeValue as InputType] || typeValue}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <div className="flex items-center gap-3 text-xs">
                                                            <label className="flex items-center gap-1 text-gray-600">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={item.required ?? false}
                                                                    onChange={(e) => handleItemRequiredToggle(section.id, item.id, e.target.checked)}
                                                                    className="h-4 w-4"
                                                                />
                                                                Obrigatório
                                                            </label>
                                                            <button
                                                                onClick={() => handleRemoveQuestion(section.id, item.id)}
                                                                className="text-red-500 font-semibold uppercase tracking-widest text-[11px]"
                                                            >
                                                                Excluir
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                onClick={() => handleAddQuestion(section.id)}
                                                className="text-blue-600 text-sm font-semibold flex items-center gap-2"
                                            >
                                                + Adicionar pergunta
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4">
                                    <button
                                        onClick={handleAddSection}
                                        className="text-blue-600 font-semibold text-sm flex items-center gap-2"
                                    >
                                        + Adicionar seção
                                    </button>
                                </div>
                                <div className="mt-6 flex justify-end gap-3">
                                    <button
                                        onClick={closeChecklistEditor}
                                        className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold hover:bg-gray-100"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        disabled={isSavingChecklistDefinition}
                                        onClick={handleSaveChecklistDefinition}
                                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-70 disabled:cursor-wait"
                                    >
                                        {isSavingChecklistDefinition ? 'Salvando...' : 'Salvar checklist'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                </main>
            </div>
        </div>
    );
};

export default App;
