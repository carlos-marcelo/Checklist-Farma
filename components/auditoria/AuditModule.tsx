
import React, { useState, useEffect, useMemo } from 'react';
import {
    AuditData,
    ViewState,
    AuditStatus,
    Group,
    Department,
    Category,
    Product
} from './types';
import { fetchLatestAudit, upsertAuditSession } from '../../supabaseService';
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
    X
} from 'lucide-react';

const ALLOWED_IDS = [66, 67, 2000, 3000, 4000, 8000, 10000];
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

const TRIER_API_BASE =
    ((import.meta as any).env?.VITE_TRIER_INTEGRATION_URL as string) || "http://localhost:8000";

type TermScopeType = 'group' | 'department' | 'category';

interface TermScope {
    type: TermScopeType;
    groupId: string;
    deptId?: string;
    catId?: string;
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

    const [selectedEmpresa, setSelectedEmpresa] = useState("Drogaria Cidade");
    const [selectedFilial, setSelectedFilial] = useState("");
    const [nextAuditNumber, setNextAuditNumber] = useState(1);
    const [dbSessionId, setDbSessionId] = useState<string | undefined>(undefined);
    const [isUpdatingStock, setIsUpdatingStock] = useState(false);

    // Fetch next audit number when branch changes
    useEffect(() => {
        let active = true;
        const loadAuditNum = async () => {
            if (!selectedFilial) return;
            try {
                const latest = await fetchLatestAudit(selectedFilial);
                if (active) {
                    if (latest && latest.status !== 'completed') {
                        setNextAuditNumber(latest.audit_number);
                        setDbSessionId(latest.id);
                        if (latest.data) {
                            // REPAIR LOGIC: If totalCost is missing (old sessions), recalculate it
                            if (latest.data.groups) {
                                latest.data.groups.forEach((g: any) => {
                                    g.departments.forEach((d: any) => {
                                        d.categories.forEach((c: any) => {
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
                            setDbSessionId(latest.id);

                            if (isMaster) {
                                const wantsToUpdate = window.confirm(`Auditoria Nº ${latest.audit_number} em aberto encontrada.\n\nDeseja carregar um NOVO arquivo de SALDOS para atualizar o estoque pendente?`);
                                if (wantsToUpdate) {
                                    setIsUpdatingStock(true);
                                } else {
                                    setIsUpdatingStock(false);
                                }
                                setView({ level: 'groups' });
                            } else {
                                // Non-master: auto-enter and warn
                                setIsUpdatingStock(false);
                                setView({ level: 'groups' });
                                const lastLoadStr = latest.updated_at ? new Date(latest.updated_at).toLocaleString('pt-BR') : 'não informada';
                                alert(`ENTRANDO EM MODO CONSULTA.\n\nAviso: O estoque exibido reflete a última carga realizada pelo usuário Master em ${lastLoadStr} e pode estar desatualizado.`);
                            }

                            let done = 0;
                            if (latest.data.groups) {
                                latest.data.groups.forEach((g: any) =>
                                    g.departments.forEach((d: any) =>
                                        d.categories.forEach((c: any) => {
                                            if (c.status === 'DONE') done += c.totalQuantity;
                                        })
                                    )
                                );
                            }
                            setInitialDoneUnits(done);
                        }
                    } else {
                        // No open audit found
                        if (!isMaster) {
                            alert("Esta filial não está disponível para visualização pois não possui um inventário aberto no momento.");
                            setSelectedFilial("");
                            setData(null);
                        } else {
                            if (latest && latest.status === 'completed') {
                                setNextAuditNumber(latest.audit_number + 1);
                            } else {
                                setNextAuditNumber(1);
                            }
                            setData(null);
                            setView({ level: 'groups' });
                        }
                    }
                }
            } catch (err) {
                console.error("Error fetching audit number:", err);
            }
        };
        loadAuditNum();
        return () => { active = false; };
    }, [selectedFilial]);

    // Derived inventory number (Auto-generated)
    const inventoryNumber = useMemo(() => {
        return selectedFilial ? `${new Date().getFullYear()}-${selectedFilial.padStart(4, '0')}-${String(nextAuditNumber).padStart(4, '0')}` : '';
    }, [selectedFilial, nextAuditNumber]);

    // Dummy setter to keep existing logic working without massive refactor
    const setInventoryNumber = (val: string) => { };

    const [fileGroups, setFileGroups] = useState<File | null>(null);
    const [fileStock, setFileStock] = useState<File | null>(null);
    const [fileDeptIds, setFileDeptIds] = useState<File | null>(null);
    const [fileCatIds, setFileCatIds] = useState<File | null>(null);

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.groups) {
                    setData(parsed);
                    if (parsed.filial) setSelectedFilial(parsed.filial);
                    if (parsed.inventoryNumber) setInventoryNumber(parsed.inventoryNumber);
                    let done = 0;
                    parsed.groups.forEach((g: any) => g.departments.forEach((d: any) => d.categories.forEach((c: any) => {
                        if (c.status === AuditStatus.DONE) done += c.totalQuantity;
                    })));
                    setInitialDoneUnits(done);
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
            setFileGroups(null);
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
                    data: data as any,
                    progress: progress
                });

                // Clear local view state to 'exit'
                localStorage.removeItem(STORAGE_KEY);
                setData(null);
                setDbSessionId(undefined);
                setSelectedFilial("");
                setFileGroups(null);
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
                    data: data as any,
                    progress: 100
                });

                alert("Auditoria finalizada com sucesso!");

                // Clear local view state to 'exit'
                localStorage.removeItem(STORAGE_KEY);
                setData(null);
                setDbSessionId(undefined);
                setSelectedFilial("");
                setFileGroups(null);
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

    const handleStartAudit = async () => {
        if (!selectedFilial) {
            alert("Selecione a filial.");
            return;
        }

        if (isUpdatingStock) {
            if (!fileStock) {
                alert("Por favor, carregue o arquivo de SALDOS.");
                return;
            }
        } else {
            if (data && data.groups && data.groups.length > 0) {
                setView({ level: 'groups' });
                return;
            }
            if (!fileGroups || !fileStock || !fileDeptIds || !fileCatIds) {
                alert("Por favor, carregue todos os arquivos para iniciar uma nova auditoria.");
                return;
            }
            if (!window.confirm(`ATENÇÃO: Você está prestes a criar um NOVO inventário (Nº ${nextAuditNumber}) para a Filial ${selectedFilial}.\n\nDeseja realmente prosseguir?`)) {
                return;
            }
        }

        setIsProcessing(true);
        try {
            if (isUpdatingStock && data) {
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
                            if (c.status !== AuditStatus.DONE) {
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

                setData(newData);
                setIsUpdatingStock(false);
                setView({ level: 'groups' });
                alert("Estoques atualizados (apenas para itens não finalizados).");
                return;
            }

            const rowsGroups = await readExcel(fileGroups!);
            const rowsStock = await readExcel(fileStock);
            const rowsDepts = await readExcel(fileDeptIds);
            const rowsCats = await readExcel(fileCatIds);

            const mapIdsAndBarcodes = (rows: any[][]) => {
                const nameToId: Record<string, string> = {};
                const barcodeToId: Record<string, string> = {};
                let lastId = "";
                rows.forEach(row => {
                    if (!row) return;
                    const currentId = row[5]?.toString().trim();
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

            const deptIdMaps = mapIdsAndBarcodes(rowsDepts);
            const catIdMaps = mapIdsAndBarcodes(rowsCats);

            const productsLookup: Record<string, any> = {};
            let currentGroupId: string | null = null;
            let currentGroupName: string | null = null;

            rowsGroups.forEach((row) => {
                if (!row || row.length < 8) return;
                const valF = row[5]?.toString().trim() || "";
                const matchF = valF.match(/(\d+)/);
                if (matchF) {
                    const idNum = parseInt(matchF[1]);
                    if (ALLOWED_IDS.includes(idNum)) {
                        currentGroupId = idNum.toString();
                        currentGroupName = row[7]?.toString().trim() || GROUP_CONFIG_DEFAULTS[currentGroupId] || `Grupo ${currentGroupId}`;
                    }
                }
                if (currentGroupId) {
                    const barcode = normalizeBarcode(row[11]);
                    if (barcode) {
                        productsLookup[barcode] = {
                            groupId: currentGroupId,
                            groupName: currentGroupName,
                            deptName: row[19]?.toString() || "OUTROS",
                            catName: row[23]?.toString() || "GERAL"
                        };
                    }
                }
            });

            const groupsMap: Record<string, Group> = {};
            rowsStock.forEach((row) => {
                if (!row || row.length < 14) return;
                const barcode = normalizeBarcode(row[1]);
                const productName = row[4]?.toString() || "Sem Descrição";
                const stockQty = parseFloat(row[13]?.toString() || "0");
                const stockCost = parseFloat(row[9]?.toString() || "0"); // Coluna J

                if (barcode && stockQty > 0) {
                    const productInfo = productsLookup[barcode];
                    if (productInfo) {
                        const isMargemZero = productInfo.groupId === "66" || productInfo.groupId === "67";
                        const finalGroupId = isMargemZero ? "66+67" : productInfo.groupId;
                        const finalGroupName = isMargemZero ? "Genérico + Similar sem margem" : productInfo.groupName;

                        if (!groupsMap[finalGroupId]) groupsMap[finalGroupId] = { id: finalGroupId, name: finalGroupName, departments: [] };

                        let dept = groupsMap[finalGroupId].departments.find(d => d.name === productInfo.deptName);
                        const resolvedDeptId = deptIdMaps.barcodeToId[barcode] || deptIdMaps.nameToId[cleanDescription(productInfo.deptName)] || "";
                        if (!dept) {
                            dept = { id: productInfo.deptName, numericId: resolvedDeptId, name: productInfo.deptName, categories: [] };
                            groupsMap[finalGroupId].departments.push(dept);
                        } else if (!dept.numericId && resolvedDeptId) dept.numericId = resolvedDeptId;

                        let cat = dept.categories.find(c => c.name === productInfo.catName);
                        const resolvedCatId = catIdMaps.barcodeToId[barcode] || catIdMaps.nameToId[cleanDescription(productInfo.catName)] || "";
                        if (!cat) {
                            cat = {
                                id: `${finalGroupId}-${productInfo.deptName}-${productInfo.catName}`,
                                numericId: resolvedCatId,
                                name: productInfo.catName,
                                itemsCount: 0,
                                totalQuantity: 0,
                                totalCost: 0,
                                status: AuditStatus.TODO,
                                products: []
                            };
                            dept.categories.push(cat);
                        } else if (!cat.numericId && resolvedCatId) cat.numericId = resolvedCatId;

                        cat.itemsCount++;
                        cat.totalQuantity += stockQty;
                        cat.totalCost += (stockQty * stockCost);
                        cat.products.push({ code: barcode, name: productName, quantity: stockQty, cost: stockCost });
                    }
                }
            });

            setData({
                groups: Object.values(groupsMap).sort((a, b) => parseInt(a.id.split('+')[0]) - parseInt(b.id.split('+')[0])),
                empresa: selectedEmpresa,
                filial: selectedFilial,
                inventoryNumber: inventoryNumber.trim()
            });
            setView({ level: 'groups' });
        } catch (err) { alert("Erro ao processar arquivos."); console.error(err); }
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
            setData({ ...payload, inventoryNumber: inventoryNumber.trim() || payload.inventoryNumber || "" });
            setView({ level: 'groups' });
            setInitialDoneUnits(0);
            setSessionStartTime(Date.now());
            setFileGroups(null);
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
            if (c.status === AuditStatus.DONE) {
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
            if (c.status === AuditStatus.DONE) {
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

    const buildTermKey = (scope: TermScope) => {
        return [scope.type, scope.groupId, scope.deptId || '', scope.catId || ''].join('|');
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
        const draft = termDrafts[key];
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

    const buildTermScopeInfo = (scope: TermScope) => {
        if (!data) return null;
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

    const handlePrintTerm = () => {
        if (!data || !termModal || !termForm) return;
        const scopeInfo = buildTermScopeInfo(termModal);
        if (!scopeInfo) return;
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
        doc.text(`Grupo: ${scopeInfo.group.name}`, 14, y);
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
        const fileName = `Termo_Auditoria_F${data.filial}_${termModal.type}_${safeName}.pdf`;
        doc.save(fileName);
    };
    const calculateProgress = (auditData: AuditData) => {
        let skus = 0, doneSkus = 0;
        if (auditData.groups) {
            auditData.groups.forEach(g => g.departments.forEach(d => d.categories.forEach(c => {
                skus += c.itemsCount;
                if (c.status === AuditStatus.DONE) doneSkus += c.itemsCount;
            })));
        }
        return skus > 0 ? (doneSkus / skus) * 100 : 0;
    };

    const toggleScopeStatus = async (groupId?: string, deptId?: string, catId?: string) => {
        if (!data) return;

        // Determinar se o escopo atual já está todo concluído
        let allDone = true;
        data.groups.forEach(g => {
            if (groupId && g.id !== groupId) return;
            g.departments.forEach(d => {
                if (deptId && d.id !== deptId) return;
                d.categories.forEach(c => {
                    if (catId && c.id !== catId) return;
                    if (c.status !== AuditStatus.DONE) allDone = false;
                });
            });
        });

        const msg = allDone
            ? "Tem certeza que deseja desmarcar? O registro será atualizado no Supabase."
            : "Tem certeza que deseja finalizar e gravar o estoque no Supabase?";

        if (!window.confirm(msg)) return;

        const nextData: AuditData = {
            ...data,
            groups: data.groups.map(g => {
                if (groupId && g.id !== groupId) return g;
                return {
                    ...g,
                    departments: g.departments.map(d => {
                        if (deptId && d.id !== deptId) return d;
                        let targetCats = d.categories;
                        if (catId) targetCats = d.categories.filter(c => c.id === catId);
                        const allDone = targetCats.every(c => c.status === AuditStatus.DONE);
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

        setData(nextData);

        try {
            const progress = calculateProgress(nextData);
            await upsertAuditSession({
                id: dbSessionId,
                branch: selectedFilial,
                audit_number: nextAuditNumber,
                status: 'open',
                data: nextData as any,
                progress: progress
            });
            alert("Estoque gravado no Supabase com sucesso!");
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
                    const isDone = c.status === AuditStatus.DONE;
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

        doc.save(`Auditoria_F${data.filial}_Analitica.pdf`);
    };

    const selectedGroup = useMemo(() => data?.groups.find(g => g.id === view.selectedGroupId), [data, view.selectedGroupId]);
    const selectedDept = useMemo(() => selectedGroup?.departments.find(d => d.id === view.selectedDeptId), [selectedGroup, view.selectedDeptId]);
    const selectedCat = useMemo(() => selectedDept?.categories.find(c => c.id === view.selectedCatId), [selectedDept, view.selectedCatId]);
    const termScopeInfo = useMemo(() => (termModal ? buildTermScopeInfo(termModal) : null), [termModal, data]);

    if (!data || isUpdatingStock) {
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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                                { f: fileGroups, set: setFileGroups, label: 'Estrutura' },
                                { f: fileStock, set: setFileStock, label: 'Saldos' },
                                { f: fileDeptIds, set: setFileDeptIds, label: 'IDs Depto' },
                                { f: fileCatIds, set: setFileCatIds, label: 'IDs Cat' }
                            ].map((item, i) => {
                                const isDisabled = (isUpdatingStock && item.label !== 'Saldos') || !isMaster;
                                return (
                                    <label key={i} className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${isDisabled ? 'opacity-30 cursor-not-allowed' : ''} ${item.f ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                                        <input type="file" className="hidden" disabled={isDisabled} onChange={e => item.set(e.target.files?.[0] || null)} />
                                        <FileSpreadsheet className={`mx-auto w-6 h-6 mb-1 ${item.f ? 'text-emerald-500' : 'text-slate-300'}`} />
                                        <p className="text-[8px] font-black uppercase truncate">{item.f ? item.f.name : item.label}</p>
                                    </label>
                                );
                            })}
                        </div>
                        <div className="space-y-3">
                            <button onClick={handleStartAudit} disabled={isProcessing || !isMaster} className={`w-full py-4 rounded-xl text-white font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 ${isProcessing || !isMaster ? 'bg-slate-300 cursor-not-allowed' : 'bg-slate-900 hover:bg-indigo-600'}`}>
                                {isProcessing ? 'Sincronizando Banco de Dados...' : isMaster ? 'Iniciar Inventário Master' : 'Apenas Master pode Iniciar'}
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
        <div className="min-h-screen bg-[#f1f5f9] pb-32 font-sans rounded-3xl overflow-hidden shadow-inner">
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
                    <button onClick={handleExportPDF} className="bg-white/10 hover:bg-white/20 px-5 py-2 rounded-xl text-white font-black text-[9px] uppercase tracking-widest flex items-center gap-2 transition-all border border-white/10">
                        <FileBox className="w-4 h-4" /> PDF ANALÍTICO
                    </button>
                    {Math.round(branchMetrics.progress) === 100 && (
                        <button onClick={handleFinishAudit} disabled={!isMaster} className={`px-5 py-2 rounded-xl text-white font-black text-[9px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg ${!isMaster ? 'bg-slate-400 opacity-50 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-400 animate-pulse'}`}>
                            <CheckSquare className="w-4 h-4" /> CONCLUIR AUDITORIA
                        </button>
                    )}
                    <button onClick={handleSafeExit} className="w-10 h-10 rounded-xl bg-red-600/20 text-red-500 border border-red-500/30 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all shadow-lg active:scale-90" title="Sair e Salvar">
                        <Power className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <div className="sticky top-[76px] z-[1001] bg-white/90 backdrop-blur-xl border-b border-slate-200 shadow-lg px-8 py-5">
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

                    <div className="flex flex-col items-center border-l border-slate-100 px-2">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">SKUs Totais</span>
                        <span className="text-2xl font-black text-slate-900 tabular-nums leading-none mt-1">{branchMetrics.skus.toLocaleString()}</span>
                        <span className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-tighter">MIX IMPORTADO</span>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-100 px-2">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Unidades Totais</span>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-xl font-black text-indigo-700 tabular-nums">{Math.round(branchMetrics.doneUnits).toLocaleString()}</span>
                            <span className="text-slate-200 text-sm">/</span>
                            <span className="text-lg font-black text-slate-300 tabular-nums">{Math.round(branchMetrics.units).toLocaleString()}</span>
                        </div>
                        <span className="text-[8px] font-bold text-indigo-300 uppercase mt-1 tracking-tighter">CONFERIDAS / TOTAIS</span>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-100 px-2">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Valor em Custo</span>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-xl font-black text-emerald-700 tabular-nums">R$ {branchMetrics.doneCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="text-slate-200 text-sm">/</span>
                            <span className="text-lg font-black text-slate-300 tabular-nums">{branchMetrics.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <span className="text-[8px] font-bold text-emerald-300 uppercase mt-1 tracking-tighter">CONFERIDO / TOTAL</span>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-100 px-2">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Mix Auditado</span>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-xl font-black text-emerald-600 tabular-nums">{branchMetrics.doneSkus.toLocaleString()}</span>
                            <span className="text-slate-200 text-sm">/</span>
                            <span className="text-lg font-black text-slate-300 tabular-nums">{branchMetrics.pendingSkus.toLocaleString()}</span>
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
                <Breadcrumbs
                    view={view}
                    onNavigate={l => setView(prev => ({ ...prev, level: l }))}
                    groupName={selectedGroup?.name}
                    deptName={selectedDept?.name}
                />

                <div className={`grid gap-6 ${view.level === 'groups' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                    {view.level === 'groups' && data.groups.map(group => {
                        const m = calcScopeMetrics(group);
                        const totalSkus = Number(m.skus);
                        const doneSkus = Number(m.doneSkus);
                        const isComplete = totalSkus > 0 && doneSkus >= totalSkus;
                        return (
                            <div key={group.id} className="bg-white rounded-[2.5rem] p-8 border border-slate-200 shadow-sm hover:shadow-xl transition-all group flex flex-col relative overflow-hidden">
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
                                                onClick={(e) => { e.stopPropagation(); toggleScopeStatus(group.id); }}
                                                disabled={!isMaster}
                                                className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all shadow-sm ${!isMaster ? 'bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed' : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white'}`}
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
                                    <ProgressBar percentage={m.progress} size="md" label={`Progresso do Grupo`} />
                                </div>
                            </div>
                        );
                    })}

                    {view.level === 'departments' && selectedGroup?.departments.map(dept => {
                        const m = calcScopeMetrics(dept);
                        const totalSkus = Number(m.skus);
                        const doneSkus = Number(m.doneSkus);
                        const isComplete = totalSkus > 0 && doneSkus >= totalSkus;
                        return (
                            <div key={dept.id} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-all p-8 flex items-center gap-10 group">
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
                                                onClick={() => toggleScopeStatus(selectedGroup?.id, dept.id)}
                                                disabled={!isMaster}
                                                className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase transition-all shadow-sm ${!isMaster ? 'bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed' : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-600 hover:text-white'}`}
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
                                    <ProgressBar percentage={m.progress} size="md" label={`Status do Departamento`} />
                                </div>
                            </div>
                        );
                    })}

                    {view.level === 'categories' && selectedDept?.categories.map(cat => (
                        <div key={cat.id} className={`p-6 rounded-[2rem] border-2 flex items-center justify-between gap-8 transition-all hover:shadow-lg group ${cat.status === AuditStatus.DONE ? 'border-emerald-500/20 bg-emerald-50/50' : 'border-slate-50 bg-white'}`}>
                            <div className="flex items-center gap-8 flex-1">
                                <div className="flex flex-col items-center justify-center bg-white border border-slate-200 rounded-2xl p-5 min-w-[120px] shadow-sm">
                                    <span className="text-[9px] font-black text-slate-400 uppercase mb-1 italic">ID CAT</span>
                                    <span className={`text-4xl font-black leading-none ${cat.status === AuditStatus.DONE ? 'text-emerald-700' : 'text-indigo-700'}`}>{cat.numericId || '--'}</span>
                                </div>
                                <div>
                                    <h3 onClick={() => setView(prev => ({ ...prev, level: 'products', selectedCatId: cat.id }))} className={`font-black text-2xl uppercase italic leading-none cursor-pointer hover:underline transition-all ${cat.status === AuditStatus.DONE ? 'text-emerald-900' : 'text-slate-900'} tracking-tighter`}>{cat.name}</h3>
                                    <div className="flex gap-10 mt-3 items-center">
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic">SKUs Importados</span><span className="text-md font-black text-slate-800 tabular-nums">{cat.itemsCount} Mix</span></div>
                                        <div className="w-px h-6 bg-slate-100"></div>
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic">Estoque Físico</span><span className="text-md font-black text-indigo-600 tabular-nums">{cat.totalQuantity.toLocaleString()} Unid.</span></div>
                                        <div className="w-px h-6 bg-slate-100"></div>
                                        <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic">Valor em Custo</span><span className="text-md font-black text-emerald-600 tabular-nums">R$ {cat.totalCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <button
                                    onClick={() => { if (cat.status === AuditStatus.DONE) openTermModal({ type: 'category', groupId: selectedGroup!.id, deptId: selectedDept!.id, catId: cat.id }); }}
                                    disabled={cat.status !== AuditStatus.DONE}
                                    className={`px-6 py-4 rounded-xl text-[10px] font-black uppercase transition-all border shadow-sm ${cat.status === AuditStatus.DONE ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:text-white hover:bg-indigo-600' : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'}`}
                                >
                                    Termo
                                </button>
                                <button onClick={() => setView(prev => ({ ...prev, level: 'products', selectedCatId: cat.id }))} className="px-6 py-4 rounded-xl bg-slate-50 text-slate-400 text-[10px] font-black uppercase hover:text-indigo-600 hover:bg-white transition-all border border-transparent hover:border-indigo-100 shadow-sm">Detalhar</button>
                                <button
                                    onClick={() => toggleScopeStatus(selectedGroup?.id, selectedDept?.id, cat.id)}
                                    disabled={!isMaster}
                                    className={`px-10 py-4 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all shadow-md active:scale-95 ${!isMaster ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : cat.status === AuditStatus.DONE ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-indigo-600'}`}
                                >
                                    {!isMaster ? 'APENAS VISUALIZAÇÃO' : cat.status === AuditStatus.DONE ? 'CONCLUÍDO' : 'FINALIZAR'}
                                </button>
                            </div>
                        </div>
                    ))}

                    {view.level === 'products' && selectedCat && (
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
                                        onClick={() => { if (selectedCat.status === AuditStatus.DONE) openTermModal({ type: 'category', groupId: selectedGroup!.id, deptId: selectedDept!.id, catId: selectedCat.id }); }}
                                        disabled={selectedCat.status !== AuditStatus.DONE}
                                        className={`px-6 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl transition-all active:scale-95 border ${selectedCat.status === AuditStatus.DONE ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-600 hover:text-white' : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'}`}
                                    >
                                        Imprimir Termo
                                    </button>
                                    <button
                                        onClick={() => toggleScopeStatus(selectedGroup?.id, selectedDept?.id, selectedCat.id)}
                                        disabled={!isMaster}
                                        className={`px-10 py-5 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] shadow-2xl transition-all active:scale-95 border-b-4 ${!isMaster ? 'bg-slate-300 border-slate-400 text-slate-500 cursor-not-allowed' : selectedCat.status === AuditStatus.DONE ? 'bg-emerald-600 border-emerald-800' : 'bg-indigo-600 border-indigo-800 hover:bg-indigo-500'}`}
                                    >
                                        {!isMaster ? 'APENAS CONSULTA' : selectedCat.status === AuditStatus.DONE ? 'REABRIR CATEGORIA' : 'CONCLUIR AUDITORIA'}
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
                    )}
                </div>
            </main>

            {view.level !== 'groups' && (
                <button onClick={() => setView(prev => ({ ...prev, level: prev.level === 'products' ? 'categories' : prev.level === 'categories' ? 'departments' : 'groups' }))} className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-16 py-6 rounded-full shadow-[0_25px_60px_rgba(0,0,0,0.4)] font-black text-[14px] uppercase tracking-[0.3em] hover:bg-indigo-600 hover:scale-110 active:scale-95 transition-all z-[2002] border-8 border-[#f1f5f9] flex items-center gap-6 group">
                    <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-3" /> Retornar Nível
                </button>
            )}

            {termModal && termForm && termScopeInfo && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[2005] flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest flex items-center gap-2">
                                <FileSignature className="w-4 h-4 text-indigo-500" />
                                Termo de Auditoria - {termModal.type === 'group' ? 'Grupo' : termModal.type === 'department' ? 'Departamento' : 'Categoria'}
                            </h3>
                            <button onClick={() => { setTermModal(null); setTermForm(null); }} className="text-slate-400 hover:text-red-500 transition-colors">
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
                                        <p className="font-bold">{termScopeInfo.group.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Nível</p>
                                        <p className="font-bold capitalize">{termModal.type}</p>
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
                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gestor 1</label>
                                    <input
                                        type="text"
                                        value={termForm.managerName2}
                                        onChange={(e) => updateTermForm(prev => ({ ...prev, managerName2: e.target.value }))}
                                        readOnly={!isMaster}
                                        className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                    />
                                </div>
                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CPF Gestor 1</label>
                                    <input
                                        type="text"
                                        value={termForm.managerCpf2}
                                        onChange={(e) => updateTermForm(prev => ({ ...prev, managerCpf2: e.target.value }))}
                                        readOnly={!isMaster}
                                        className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                    />
                                </div>
                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gestor 2</label>
                                    <input
                                        type="text"
                                        value={termForm.managerName}
                                        onChange={(e) => updateTermForm(prev => ({ ...prev, managerName: e.target.value }))}
                                        readOnly={!isMaster}
                                        className={`w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700 ${!isMaster ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                                    />
                                </div>
                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CPF Gestor 2</label>
                                    <input
                                        type="text"
                                        value={termForm.managerCpf}
                                        onChange={(e) => updateTermForm(prev => ({ ...prev, managerCpf: e.target.value }))}
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
                                            <SignaturePad label="Gestor 1" onEnd={(dataUrl) => updateTermForm(prev => ({ ...prev, managerSignature2: dataUrl }))} />
                                        ) : (
                                            <div className="border border-slate-100 rounded-xl bg-slate-50 h-40 flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase tracking-widest italic">Assinatura Pendente</div>
                                        )}
                                    </div>
                                    <div>
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
                                            <SignaturePad label="Gestor 2" onEnd={(dataUrl) => updateTermForm(prev => ({ ...prev, managerSignature: dataUrl }))} />
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
                </div>
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
