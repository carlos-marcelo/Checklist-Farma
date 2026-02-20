
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
    insertAppEventLog
} from '../../supabaseService';
import ProgressBar from './ProgressBar';
import Breadcrumbs from './Breadcrumbs';
import SignaturePad from '../SignaturePad';
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
    X
} from 'lucide-react';

const GROUP_UPLOAD_IDS = ['2000', '3000', '4000', '8000', '10000', '66', '67'] as const;
type GroupUploadId = typeof GROUP_UPLOAD_IDS[number];
const ALLOWED_IDS = GROUP_UPLOAD_IDS.map(id => Number(id));
const FILIAIS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18];
const STORAGE_KEY = 'audit_flow_v72_master';

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
}

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
    const [trierError, setTrierError] = useState<string | null>(null);
    const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
    const [initialDoneUnits, setInitialDoneUnits] = useState<number>(0);
    const [termModal, setTermModal] = useState<TermScope | null>(null);
    const [termForm, setTermForm] = useState<TermForm | null>(null);
    const [termDrafts, setTermDrafts] = useState<Record<string, TermForm>>({});
    const [auditLookup, setAuditLookup] = useState('');
    const [auditLookupOpen, setAuditLookupOpen] = useState(false);
    const auditLookupInputRef = useRef<HTMLInputElement | null>(null);

    const [selectedEmpresa, setSelectedEmpresa] = useState("Drogaria Cidade");
    const [selectedFilial, setSelectedFilial] = useState("");
    const selectedCompany = useMemo(() => companies.find(c => c.name === selectedEmpresa), [companies, selectedEmpresa]);
    const [nextAuditNumber, setNextAuditNumber] = useState(1);
    const [dbSessionId, setDbSessionId] = useState<string | undefined>(undefined);
    const [isUpdatingStock, setIsUpdatingStock] = useState(false);

    const loadAuditNum = useCallback(async (silent: boolean = false) => {
        if (!selectedFilial) return;
        try {
            const latest = await fetchLatestAudit(selectedFilial);

            // Se estiver em polling (silent) e já tivermos esse ID carregado, ignoramos alertas
            if (silent && latest && dbSessionId === latest.id) {
                return;
            }

            if (latest && latest.status !== 'completed') {
                setNextAuditNumber(latest.audit_number);
                setDbSessionId(latest.id);

                if (latest.data) {
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
                    setData(latest.data);
                    const draftsFromData = (latest.data as any).termDrafts || {};
                    setTermDrafts(draftsFromData);
                    setDbSessionId(latest.id);

                    if (!silent) {
                        const isNewSession = dbSessionId !== latest.id;

                        if (isMaster) {
                            // Só pergunta se for uma nova sessão (ou se o usuário forçado o refresh manual)
                            // Se for refresh manual (silent=false) mas a sessão for a mesma, talvez não queira perguntar sempre.
                            // Mas se ele clicou no botão ATUALIZAR, talvez queira. 
                            // Vamos manter o confirm apenas se o ID mudar ou se não tivermos dados ainda.
                            if (isNewSession || !data) {
                                const wantsToUpdate = window.confirm(`Auditoria Nº ${latest.audit_number} em aberto encontrada.\n\nDeseja abrir a tela para carregar um NOVO arquivo de SALDOS para atualizar o estoque pendente?`);
                                if (wantsToUpdate) {
                                    setIsUpdatingStock(true);
                                    // Em auditoria já iniciada, só permitimos troca de SALDOS.
                                    setGroupFiles(createInitialGroupFiles());
                                    setFileDeptIds(null);
                                    setFileCatIds(null);
                                    setFileStock(null);
                                } else {
                                    setIsUpdatingStock(false);
                                }
                            }
                            setView({ level: 'groups' });
                        } else {
                            // Non-master: auto-enter and warn ONLY if it is a new session for this user
                            setIsUpdatingStock(false);
                            setView({ level: 'groups' });

                            if (isNewSession || !data) {
                                const lastLoadStr = latest.updated_at ? new Date(latest.updated_at).toLocaleString('pt-BR') : 'não informada';
                                alert(`ENTRANDO EM MODO CONSULTA.\n\nAviso: O estoque exibido reflete a última carga realizada pelo usuário Master em ${lastLoadStr} e pode estar desatualizado.`);
                            }
                        }
                    } else if (!data) {
                        // Se for polling mas não estávamos em uma auditoria, entra automaticamente
                        setIsUpdatingStock(false);
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
                setNextAuditNumber(latest ? latest.audit_number + 1 : 1);
                setDbSessionId(undefined);
                if (!silent) {
                    setData(null);
                } else if (data) {
                    // Evita limpar sessão local ainda não sincronizada.
                    if (dbSessionId) {
                        alert("Esta auditoria foi concluída ou removida por outro usuário.");
                        setData(null);
                        setView({ level: 'groups' });
                    }
                }
            }
        } catch (error) {
            console.error('Error loading audit info:', error);
        }
    }, [selectedFilial, dbSessionId, isMaster, data]);

    // Carga Inicial
    useEffect(() => {
        if (selectedFilial) {
            loadAuditNum();
        }
    }, [selectedFilial]);

    // Polling (30s) - SEM a chamada de loadAuditNum() inicial
    useEffect(() => {
        if (!selectedFilial) return;

        const interval = setInterval(() => {
            console.log('🔄 [AuditFlow] Verificação automática...');
            loadAuditNum(true); // Silent check
        }, 30000);

        return () => clearInterval(interval);
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
    const selectedGroupFiles = useMemo(
        () => GROUP_UPLOAD_IDS
            .map(groupId => ({ groupId, file: groupFiles[groupId] }))
            .filter((entry): entry is { groupId: GroupUploadId; file: File } => !!entry.file),
        [groupFiles]
    );

    const setGroupFile = (groupId: GroupUploadId, file: File | null) => {
        setGroupFiles(prev => ({ ...prev, [groupId]: file }));
    };

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed) {
                    // Restore basic settings but let loadAuditNum fetch the fresh 'data' from Supabase
                    if (parsed.filial) setSelectedFilial(parsed.filial);
                    if (parsed.inventoryNumber) setInventoryNumber(parsed.inventoryNumber);
                }
            } catch (e) {
                localStorage.removeItem(STORAGE_KEY);
            }
        }
    }, []);


    useEffect(() => {
        if (data) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
    }, [data]);

    const handleSafeExit = async () => {
        if (!selectedFilial) {
            setData(null);
            setView({ level: 'groups' });
            return;
        }

        // Se não for Master, não precisa confirmar nem salvar (já que não salvou nada)
        if (!isMaster) {
            localStorage.removeItem(STORAGE_KEY);
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
            return;
        }

        if (window.confirm("Deseja sair da auditoria? Seu progresso será salvo automaticamente e você poderá retomar depois.")) {
            try {
                setIsProcessing(true);
                // Calculate current progress
                const progress = calculateProgress(data!);

                // Save to Supabase
                await upsertAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'open',
                    data: { ...data, termDrafts } as any,
                    progress: progress,
                    user_email: userEmail
                });

                // Clear local view state to 'exit'
                localStorage.removeItem(STORAGE_KEY);
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
                console.error("Error saving session:", err);
                alert("Erro ao salvar sessão. Tente novamente.");
            } finally {
                setIsProcessing(false);
            }
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
                await upsertAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'completed',
                    data: { ...data, termDrafts } as any,
                    progress: 100,
                    user_email: userEmail
                });

                alert("Auditoria finalizada com sucesso!");

                // Clear local view state to 'exit'
                localStorage.removeItem(STORAGE_KEY);
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
        let s = val.toString().trim();
        if (s.includes('E+') || s.includes('e+')) {
            s = Number(val).toLocaleString('fullwide', { useGrouping: false });
        }
        return s.replace(/\D/g, "").replace(/^0+/, "");
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
            groups: selectedGroupFiles.map(({ groupId, file }) => ({
                groupId,
                file: toUploadedFileMeta(file)
            })),
            stock: toUploadedFileMeta(fileStock),
            deptIds: toUploadedFileMeta(fileDeptIds),
            catIds: toUploadedFileMeta(fileCatIds)
        };
    };

    const handleStartAudit = async () => {
        if (!selectedFilial) {
            alert("Selecione a filial.");
            return;
        }

        const hasStructureFiles = selectedGroupFiles.length > 0;
        const hasOpenStructure = !!(data && data.groups && data.groups.length > 0);
        const shouldMergeStockOnly = hasOpenStructure;

        if (!fileStock) {
            alert("Por favor, carregue o arquivo de SALDOS.");
            return;
        }

        if (shouldMergeStockOnly && hasStructureFiles) {
            alert("A auditoria já foi iniciada. Após o início, somente o arquivo de SALDOS pode ser alterado.");
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

        if (!shouldMergeStockOnly) {
            if (!window.confirm(`ATENÇÃO: Você está prestes a criar um NOVO inventário (Nº ${nextAuditNumber}) para a Filial ${selectedFilial}.\n\nDeseja realmente prosseguir?`)) {
                return;
            }
        }

        setIsProcessing(true);
        try {
            if (shouldMergeStockOnly && data) {
                // Lógica de MERGE de estoque
                const rowsStock = await readExcel(fileStock!);
                const stockMap: Record<string, { q: number; c: number }> = {};
                rowsStock.forEach(row => {
                    if (!row || row.length < 14) return;
                    const b = normalizeBarcode(row[1]);
                    const q = parseFloat(row[13]?.toString() || "0");
                    const c = parseFloat(row[9]?.toString() || "0"); // Coluna J
                    if (b) stockMap[b] = { q, c };
                });

                const newData = { ...data };
                newData.groups.forEach(g => {
                    g.departments.forEach(d => {
                        d.categories.forEach(c => {
                            if (!isDoneStatus(c.status)) {
                                c.totalQuantity = 0;
                                c.totalCost = 0;
                                c.products.forEach(p => {
                                    const entry = stockMap[p.code] || { q: 0, c: 0 };
                                    p.quantity = entry.q;
                                    p.cost = entry.c;
                                    c.totalQuantity += entry.q;
                                    c.totalCost += (entry.q * entry.c);
                                });
                            }
                        });
                    });
                });

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
                const persistedData = { ...newData, sourceFiles: nextSourceFiles } as any;
                const progress = calculateProgress(persistedData as AuditData);
                const savedSession = await upsertAuditSession({
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

            const rowsGroupsByFile = await Promise.all(selectedGroupFiles.map(entry => readExcel(entry.file)));
            const rowsStock = await readExcel(fileStock);

            const mapIdsAndBarcodes = (rows: any[][]) => {
                const nameToId: Record<string, string> = {};
                const barcodeToId: Record<string, string> = {};
                let lastId = "";
                rows.forEach(row => {
                    if (!row) return;
                    const parsedId = parseSheetNumericCode(row[5]);
                    const currentId = parsedId !== null ? String(parsedId) : row[5]?.toString().trim();
                    if (currentId) lastId = currentId;
                    const currentDesc = row[7]?.toString();
                    if (lastId) {
                        if (currentDesc) nameToId[cleanDescription(currentDesc)] = lastId;
                        row.forEach(cell => {
                            const b = normalizeBarcode(cell);
                            if (b.length >= 8 && b.length <= 14) barcodeToId[b] = lastId;
                        });
                    }
                });
                return { nameToId, barcodeToId };
            };

            const emptyIdsMap = { nameToId: {} as Record<string, string>, barcodeToId: {} as Record<string, string> };
            const deptIdMaps = fileDeptIds ? mapIdsAndBarcodes(await readExcel(fileDeptIds)) : emptyIdsMap;
            const catIdMaps = fileCatIds ? mapIdsAndBarcodes(await readExcel(fileCatIds)) : emptyIdsMap;

            type ProductScope = { groupId: string; groupName: string; deptId: string; deptName: string; catId: string; catName: string };
            const productsByBarcode: Record<string, ProductScope[]> = {};
            const productsByReduced: Record<string, ProductScope[]> = {};

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

            const groupFileRows = selectedGroupFiles.map((entry, idx) => ({
                groupId: entry.groupId,
                rows: rowsGroupsByFile[idx] || []
            }));

            groupFileRows.forEach(({ groupId, rows }) => {
                const groupName = GROUP_CONFIG_DEFAULTS[groupId] || `Grupo ${groupId}`;

                rows.forEach((row) => {
                    if (!row || row.length < 4) return;

                    // Cadastro individual: K = código de barras, C = código reduzido, S = departamento, W = categoria
                    const barcodeFromCadastro = normalizeBarcode(row[10]);
                    const reducedFromCadastro = normalizeBarcode(row[2]);
                    if (!barcodeFromCadastro && !reducedFromCadastro) return;

                    const deptCell = parseHierarchyCell(row[18], "OUTROS");
                    const catCell = parseHierarchyCell(row[22], "GERAL");

                    const scope: ProductScope = {
                        groupId,
                        groupName,
                        deptId: deptCell.numericId,
                        deptName: deptCell.name,
                        catId: catCell.numericId,
                        catName: catCell.name
                    };

                    addScope(productsByBarcode, barcodeFromCadastro, scope);
                    addScope(productsByReduced, reducedFromCadastro, scope);
                });
            });

            const groupsMap: Record<string, Group> = {};
            rowsStock.forEach((row) => {
                if (!row || row.length < 14) return;
                // Estoque: B = código de barras
                const barcode = normalizeBarcode(row[1]);
                const productName = row[4]?.toString() || "Sem Descrição";
                const stockQty = parseFloat(row[13]?.toString() || "0");
                const stockCost = parseFloat(row[9]?.toString() || "0"); // Coluna J

                if (stockQty > 0) {
                    // Fallback por código reduzido caso o barcode não esteja no cadastro
                    const reducedCandidates = [
                        normalizeBarcode(row[2]), // C
                        normalizeBarcode(row[7]), // H
                        normalizeBarcode(row[0])  // A
                    ].filter(Boolean);
                    const reduced = reducedCandidates[0] || "";

                    const byBarcode = barcode ? (productsByBarcode[barcode] || []) : [];
                    const byReduced = reduced ? (productsByReduced[reduced] || []) : [];
                    const mergedMap = new Map<string, ProductScope>();
                    [...byBarcode, ...byReduced].forEach(scope => {
                        const deptKey = scope.deptId || scope.deptName;
                        const catKey = scope.catId || scope.catName;
                        mergedMap.set(`${scope.groupId}|${deptKey}|${catKey}`, scope);
                    });
                    const productInfos = Array.from(mergedMap.values());
                    if (productInfos.length === 0) return;

                    productInfos.forEach(productInfo => {
                        const finalGroupId = productInfo.groupId;
                        const finalGroupName = productInfo.groupName;

                        if (!groupsMap[finalGroupId]) groupsMap[finalGroupId] = { id: finalGroupId, name: finalGroupName, departments: [] };

                        const deptIdentity = productInfo.deptId || productInfo.deptName;
                        let dept = groupsMap[finalGroupId].departments.find(d => d.id === deptIdentity || d.name === productInfo.deptName);
                        const resolvedDeptId = deptIdMaps.barcodeToId[barcode] || deptIdMaps.nameToId[cleanDescription(productInfo.deptName)] || "";
                        if (!dept) {
                            dept = {
                                id: deptIdentity,
                                numericId: productInfo.deptId || resolvedDeptId || undefined,
                                name: productInfo.deptName,
                                categories: []
                            };
                            groupsMap[finalGroupId].departments.push(dept);
                        } else if (!dept.numericId && (productInfo.deptId || resolvedDeptId)) {
                            dept.numericId = productInfo.deptId || resolvedDeptId;
                        }

                        const catIdentity = productInfo.catId || productInfo.catName;
                        const catNodeId = `${finalGroupId}-${deptIdentity}-${catIdentity}`;
                        let cat = dept.categories.find(c => c.id === catNodeId || c.name === productInfo.catName);
                        const resolvedCatId = catIdMaps.barcodeToId[barcode] || catIdMaps.nameToId[cleanDescription(productInfo.catName)] || "";
                        if (!cat) {
                            cat = {
                                id: catNodeId,
                                numericId: productInfo.catId || resolvedCatId || undefined,
                                name: productInfo.catName,
                                itemsCount: 0,
                                totalQuantity: 0,
                                totalCost: 0,
                                status: AuditStatus.TODO,
                                products: []
                            };
                            dept.categories.push(cat);
                        } else if (!cat.numericId && (productInfo.catId || resolvedCatId)) {
                            cat.numericId = productInfo.catId || resolvedCatId;
                        }

                        cat.itemsCount++;
                        cat.totalQuantity += stockQty;
                        cat.totalCost += (stockQty * stockCost);
                        cat.products.push({
                            code: barcode || reduced || '',
                            reducedCode: reduced || undefined,
                            name: productName,
                            quantity: stockQty,
                            cost: stockCost
                        });
                    });
                }
            });

            const nextData: AuditData = {
                groups: Object.values(groupsMap).sort((a, b) => parseInt(a.id.split('+')[0]) - parseInt(b.id.split('+')[0])),
                empresa: selectedEmpresa,
                filial: selectedFilial,
                inventoryNumber: inventoryNumber.trim()
            };
            const persistedData = {
                ...nextData,
                termDrafts: {},
                sourceFiles: buildStructureSourceMeta()
            } as any;
            const progress = calculateProgress(nextData);
            const savedSession = await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: persistedData,
                progress: progress,
                user_email: userEmail
            });
            if (!savedSession) {
                throw new Error("Falha ao salvar auditoria inicial no Supabase.");
            }

            setDbSessionId(savedSession.id);
            setNextAuditNumber(savedSession.audit_number);
            setTermDrafts({});
            setData((savedSession.data as AuditData) || nextData);
            setGroupFiles(createInitialGroupFiles());
            setFileDeptIds(null);
            setFileCatIds(null);
            setFileStock(null);
            setIsUpdatingStock(false);
            setView({ level: 'groups' });
        } catch (err) {
            alert("Erro ao processar/salvar arquivos da auditoria.");
            console.error(err);
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
            const nextData = { ...payload, inventoryNumber: inventoryNumber.trim() || payload.inventoryNumber || "" };
            const progress = calculateProgress(nextData as AuditData);
            const savedSession = await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: nextData as any,
                progress: progress,
                user_email: userEmail
            });
            if (!savedSession) {
                throw new Error("Falha ao salvar dados iniciais do Trier no Supabase.");
            }

            setDbSessionId(savedSession.id);
            setNextAuditNumber(savedSession.audit_number);
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
            const customKey = (scope.customScopes || []).map(s => partialScopeKey(s)).join(',');
            return `custom|${scope.batchId || ''}|${customKey}`;
        }
        return [scope.type, scope.groupId || '', scope.deptId || '', scope.catId || ''].join('|');
    };

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
        if (!draft && scope.type === 'custom' && scope.batchId) {
            const legacyKey = `custom|${(scope.customScopes || []).map(s => partialScopeKey(s)).join(',')}`;
            draft = termDrafts[legacyKey];
        }
        const nextForm = draft
            ? (!draft.inventoryNumber && (inventoryNumber || data?.inventoryNumber)
                ? { ...draft, inventoryNumber: inventoryNumber || data?.inventoryNumber || '' }
                : draft)
            : createDefaultTermForm();
        setTermModal(scope);
        setTermForm(nextForm);
        if (draft && nextForm !== draft) {
            setTermDrafts(current => ({ ...current, [key]: nextForm }));
        }
    };

    const updateTermForm = (updater: (prev: TermForm) => TermForm) => {
        setTermForm(prev => {
            if (!prev) return prev;
            const next = updater(prev);
            if (termModal) {
                const key = buildTermKey(termModal);
                setTermDrafts(current => ({ ...current, [key]: next }));
            }
            return next;
        });
    };

    const closeTermModal = useCallback(() => {
        setTermModal(null);
        setTermForm(null);
    }, []);

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
            const nextDrafts = { ...termDrafts, [key]: termForm };
            setTermDrafts(nextDrafts);
            try {
                // Persistence consolidated in audit_sessions (data field)
                const progress = calculateProgress(data || {} as any);
                await upsertAuditSession({
                    id: dbSessionId,
                    branch: selectedFilial,
                    audit_number: nextAuditNumber,
                    status: 'open',
                    data: { ...data, termDrafts: nextDrafts } as any,
                    progress: progress,
                    user_email: userEmail
                });
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

        const productRows = scopeInfo.products.map(p => [
            p.groupName,
            p.deptName,
            p.catName,
            p.code,
            p.name,
            Math.round(p.quantity).toLocaleString(),
            `R$ ${(p.cost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `R$ ${((p.cost || 0) * p.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ]);

        // @ts-ignore
        doc.autoTable({
            startY: afterSignY,
            head: [['Grupo', 'Departamento', 'Categoria', 'Código', 'Produto', 'Qtd', 'Custo Unit', 'Custo Total']],
            body: productRows,
            foot: [[
                { content: 'TOTAIS DOS ITENS CONFERIDOS', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
                Math.round(scopeInfo.products.reduce((acc, p) => acc + p.quantity, 0)).toLocaleString(),
                '',
                `R$ ${scopeInfo.products.reduce((acc, p) => acc + (p.quantity * (p.cost || 0)), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ]],
            theme: 'striped',
            styles: { fontSize: 7, cellPadding: 1.5 },
            headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
            footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
        });

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
        const normalizedPartials = partials.filter(p => !!p.startedAt);
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

    const clearPartialProgress = useCallback(async (reason?: 'expired' | 'manual' | 'invalid', discardCompleted = false) => {
        if (!data?.partialStarts || data.partialStarts.length === 0) return;
        const nextData = applyPartialScopes(
            discardCompleted ? { ...data, partialCompleted: [] } : data,
            []
        );
        setData(nextData);
        try {
            const progress = calculateProgress(nextData);
            await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts } as any,
                progress: progress,
                user_email: userEmail
            });
            // Update localStorage immediately
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                ...nextData,
                filial: selectedFilial,
                inventoryNumber
            }));
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

            if (reason === 'expired') {
                alert("Contagem parcial expirada. Inicie novamente para continuar.");
            }
        } catch (err) {
            console.error("Error clearing partial:", err);
        }
    }, [data, dbSessionId, selectedFilial, nextAuditNumber, applyPartialScopes]);

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
            await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts } as any,
                progress: progress,
                user_email: userEmail
            });
            // Update localStorage immediately with the clean state
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                ...nextData,
                filial: selectedFilial,
                inventoryNumber
            }));
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
        const scopeCatsGuard = getScopeCategories(groupId, deptId, catId).map(s => s.cat);
        const scopeAllDone = scopeCatsGuard.length > 0 && scopeCatsGuard.every(c => isDoneStatus(c.status));
        if (scopeAllDone) {
            alert("Para iniciar contagem parcial, primeiro desmarque a conclusão.");
            return;
        }
        const nowIso = new Date().toISOString();
        const existing = data.partialStarts || [];
        const catMap = new Map<string, { startedAt: string; groupId: string; deptId: string; catId: string }>();

        existing.forEach(p => {
            const expanded = getScopeCategories(p.groupId, p.deptId, p.catId);
            expanded.forEach(({ group, dept, cat }) => {
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

        const scopeCats = getScopeCategories(groupId, deptId, catId);
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
            await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts } as any,
                progress: progress,
                user_email: userEmail
            });
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

        const msg = allDone
            ? "Tem certeza que deseja desmarcar? Isso vai remover os termos e zerar no Supabase."
            : "Tem certeza que deseja finalizar e gravar o estoque no Supabase?";

        if (!window.confirm(msg)) return;

        const existingPartials = data.partialStarts || [];
        const filteredPartials = existingPartials.filter(p => !scopeContainsPartial(p, groupId, deptId, catId));
        const baseCompleted = allDone
            ? (data.partialCompleted || []).filter(p => !scopeContainsPartial(p, groupId, deptId, catId))
            : (data.partialCompleted || []);
        let nextCompleted = baseCompleted;
        let nextBatchId = data.lastPartialBatchId;
        if (!allDone) {
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
        } else {
            nextBatchId = getLatestBatchId(baseCompleted);
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
                        let targetCats = d.categories;
                        if (catId) targetCats = d.categories.filter(c => c.id === catId);
                        const allDone = targetCats.every(c => isDoneStatus(c.status));
                        const newStatus = allDone ? AuditStatus.TODO : AuditStatus.DONE;
                        return {
                            ...d,
                            categories: d.categories.map(c => {
                                if (catId && c.id !== catId) return c;
                                return { ...c, status: newStatus };
                            })
                        };
                    })
                };
            })
        };

        const nextData = applyPartialScopes(nextDataRaw, filteredPartials);

        setData(nextData);

        try {
            const progress = calculateProgress(nextData);
            await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: { ...nextData, termDrafts } as any,
                progress: progress,
                user_email: userEmail
            });
            // Update localStorage immediately
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                ...nextData,
                filial: selectedFilial,
                inventoryNumber
            }));
            insertAppEventLog({
                company_id: selectedCompany?.id || null,
                branch: selectedFilial || null,
                area: null,
                user_email: userEmail,
                user_name: userName || null,
                app: 'auditoria',
                event_type: allDone ? 'audit_partial_pause' : 'audit_partial_finalize',
                entity_type: 'partial_scope',
                entity_id: `${groupId || ''}:${deptId || ''}:${catId || ''}`,
                status: 'success',
                success: true,
                source: 'web',
                event_meta: { groupId, deptId, catId, action: allDone ? 'unmark' : 'finalize' }
            }).catch(() => { });
            alert(allDone
                ? "Contagem concluída removida e zerada no Supabase."
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

    useEffect(() => {
        if (!data?.partialStarts || data.partialStarts.length === 0) return;
        const now = new Date();
        const valid = data.partialStarts.filter(p => {
            const startedAt = new Date(p.startedAt);
            if (isNaN(startedAt.getTime())) return false;
            return startedAt.toDateString() === now.toDateString();
        });
        if (valid.length !== data.partialStarts.length) {
            const nextData = applyPartialScopes(data, valid);
            setData(nextData);
            (async () => {
                try {
                    const progress = calculateProgress(nextData);
                    await upsertAuditSession({
                        id: dbSessionId,
                        branch: selectedFilial,
                        audit_number: nextAuditNumber,
                        status: 'open',
                        data: nextData as any,
                        progress: progress,
                        user_email: userEmail
                    });
                    alert("Contagem parcial expirada. Inicie novamente para continuar.");
                } catch (err) {
                    console.error("Error clearing partial:", err);
                }
            })();
        }

        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
        const timeoutMs = midnight.getTime() - Date.now() + 1000;
        const timer = window.setTimeout(() => {
            clearPartialProgress('expired');
        }, Math.max(1000, timeoutMs));
        return () => window.clearTimeout(timer);
    }, [data?.partialStarts, applyPartialScopes, dbSessionId, selectedFilial, nextAuditNumber, clearPartialProgress, calculateProgress]);

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
        const customScopes = Array.from(map.values());
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
        if (!isMaster) {
            alert("Apenas usuário master pode zerar termos e contagens concluídas.");
            return;
        }
        if (!window.confirm("Tem certeza que deseja zerar TODAS as contagens concluídas e termos personalizados desta auditoria?")) return;

        const filteredDrafts = Object.fromEntries(
            Object.entries(termDrafts || {}).filter(([key]) => !key.startsWith('custom|'))
        );

        const resetGroups = data.groups.map(g => ({
            ...g,
            departments: g.departments.map(d => ({
                ...d,
                categories: d.categories.map(c => ({
                    ...c,
                    status: AuditStatus.TODO
                }))
            }))
        }));

        const nextData: AuditData = {
            ...data,
            groups: resetGroups,
            partialStarts: [],
            partialCompleted: [],
            lastPartialBatchId: undefined,
            termDrafts: filteredDrafts
        };

        setTermDrafts(filteredDrafts);
        setData(nextData);
        setInitialDoneUnits(0);

        try {
            // Persistence consolidated in audit_sessions (data field)
            const progress = calculateProgress(nextData);
            await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: nextData as any,
                progress: progress,
                user_email: userEmail
            });
            // Update localStorage immediately
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                ...nextData,
                filial: selectedFilial,
                inventoryNumber
            }));
            alert("Contagens concluídas e termos personalizados zerados.");

        } catch (err) {
            console.error("Error resetting partial history:", err);
            alert("Erro ao zerar no Supabase. Os dados locais foram limpos.");
        }
    }, [data, isMaster, termDrafts, selectedFilial, nextAuditNumber, dbSessionId, calculateProgress]);

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
                                return (
                                    <label
                                        key={`group-upload-${groupId}`}
                                        className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${(!isMaster || structureLocked) ? 'opacity-30 cursor-not-allowed' : ''} ${selectedFile ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}
                                    >
                                        <input
                                            type="file"
                                            className="hidden"
                                            disabled={!isMaster || structureLocked}
                                            onChange={e => setGroupFile(groupId, e.target.files?.[0] || null)}
                                        />
                                        <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${selectedFile ? 'text-emerald-500' : 'text-slate-300'}`} />
                                        <p className="text-[8px] font-black uppercase truncate">{selectedFile ? selectedFile.name : `Cadastro ${groupId}`}</p>
                                        <p className="text-[8px] font-bold text-slate-500 mt-1">
                                            {selectedFile ? `Grupo ${groupId} carregado` : `Grupo ${groupId}`}
                                        </p>
                                    </label>
                                );
                            })}

                            <label className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${!isMaster ? 'opacity-30 cursor-not-allowed' : ''} ${fileStock ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                                <input type="file" className="hidden" disabled={!isMaster} onChange={e => setFileStock(e.target.files?.[0] || null)} />
                                <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${fileStock ? 'text-emerald-500' : 'text-slate-300'}`} />
                                <p className="text-[8px] font-black uppercase truncate">{fileStock ? fileStock.name : 'Saldos'}</p>
                            </label>

                            <label className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${(!isMaster || structureLocked) ? 'opacity-30 cursor-not-allowed' : ''} ${fileDeptIds ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                                <input type="file" className="hidden" disabled={!isMaster || structureLocked} onChange={e => setFileDeptIds(e.target.files?.[0] || null)} />
                                <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${fileDeptIds ? 'text-emerald-500' : 'text-slate-300'}`} />
                                <p className="text-[8px] font-black uppercase truncate">{fileDeptIds ? fileDeptIds.name : 'IDs Depto (opcional)'}</p>
                            </label>

                            <label className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${(!isMaster || structureLocked) ? 'opacity-30 cursor-not-allowed' : ''} ${fileCatIds ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                                <input type="file" className="hidden" disabled={!isMaster || structureLocked} onChange={e => setFileCatIds(e.target.files?.[0] || null)} />
                                <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${fileCatIds ? 'text-emerald-500' : 'text-slate-300'}`} />
                                <p className="text-[8px] font-black uppercase truncate">{fileCatIds ? fileCatIds.name : 'IDs Cat (opcional)'}</p>
                            </label>
                        </div>
                        {structureLocked && (
                            <p className="text-[10px] font-bold text-amber-600">
                                Estrutura já iniciada nesta auditoria. Após o início, somente o arquivo de SALDOS pode ser alterado.
                            </p>
                        )}
                        <p className="text-[10px] font-bold text-slate-500">
                            Cadastros por grupo carregados em caixas fixas (2000, 3000, 4000, 8000, 10000, 66 e 67). Carregados: <span className="text-slate-700">{selectedGroupFiles.length}/{GROUP_UPLOAD_IDS.length}</span>.
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
                    <button onClick={() => loadAuditNum()} className="bg-indigo-500/20 hover:bg-indigo-500/40 px-5 py-2 rounded-xl text-white font-black text-[9px] uppercase tracking-widest flex items-center gap-2 transition-all border border-indigo-400/30">
                        <RefreshCw className="w-4 h-4" /> ATUALIZAR
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
                                    <ProgressBar percentage={groupProgressValue} size="md" label={`Progresso do Grupo`} tone={groupAllDone ? 'green' : groupHasInProgress ? 'blue' : 'auto'} />
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
                                <div className="flex items-center gap-8 flex-1">
                                    <div className="flex flex-col items-center justify-center bg-white border border-slate-200 rounded-2xl p-5 min-w-[120px] shadow-sm">
                                        <span className="text-[9px] font-black text-slate-400 uppercase mb-1 italic">ID CAT</span>
                                        <span className={`text-4xl font-black leading-none ${catStatus === AuditStatus.DONE ? 'text-emerald-700' : catStatus === AuditStatus.IN_PROGRESS ? 'text-blue-700' : 'text-indigo-700'}`}>{cat.numericId || '--'}</span>
                                    </div>
                                    <div>
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
                                    </div>
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
                                        <p className="font-semibold">{termScopeInfo.departments.map(d => d.name).join(', ') || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Categorias</p>
                                        <p className="font-semibold">{termScopeInfo.categories.map(c => c.name).join(', ') || '-'}</p>
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
                                            <SignaturePad onEnd={(dataUrl) => updateTermForm(prev => ({ ...prev, managerSignature2: dataUrl }))} />
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
                                            <SignaturePad onEnd={(dataUrl) => updateTermForm(prev => ({ ...prev, managerSignature: dataUrl }))} />
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
                                                            onEnd={(dataUrl) => updateTermForm(prev => ({
                                                                ...prev,
                                                                collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, signature: dataUrl } : c)
                                                            }))}
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
            )}

            <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f8fafc; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 12px; border: 3px solid #f8fafc; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
        </div>
    );
};

export default AuditModule;
