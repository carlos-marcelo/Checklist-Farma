
import React, { useState, useEffect, useMemo } from 'react';
import { AuditData, ViewState, AuditStatus, Group, Department, Category, Product } from './types';
import ProgressBar from './components/ProgressBar';
import Breadcrumbs from './components/Breadcrumbs';
import { fetchLatestAudit, upsertAuditSession, fetchAuditSession } from '../supabaseService';

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
  managerName: string;
  managerCpf: string;
  collaborators: TermCollaborator[];
}

const App: React.FC = () => {
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
  const [auditNumber, setAuditNumber] = useState<number>(1);
  const [dbSessionId, setDbSessionId] = useState<string | undefined>(undefined);

  const [fileGroups, setFileGroups] = useState<File | null>(null);
  const [fileStock, setFileStock] = useState<File | null>(null);
  const [fileDeptIds, setFileDeptIds] = useState<File | null>(null);
  const [fileCatIds, setFileCatIds] = useState<File | null>(null);

  // Carregar dados iniciais ao selecionar filial
  useEffect(() => {
    if (!selectedFilial) return;

    const loadSession = async () => {
      setIsProcessing(true);
      try {
        const latest = await fetchLatestAudit(selectedFilial);
        if (latest) {
          if (latest.status === 'open') {
            // Retomar
            const parsed = latest.data;
            setData({ ...parsed, sessionId: latest.id, auditNumber: latest.audit_number });
            setAuditNumber(latest.audit_number);
            setDbSessionId(latest.id);

            let done = 0;
            if (parsed && parsed.groups) {
              parsed.groups.forEach((g: any) => g.departments.forEach((d: any) => d.categories.forEach((c: any) => {
                if (c.status === AuditStatus.DONE) done += c.totalQuantity;
              })));
            }
            setInitialDoneUnits(done);
            alert(`Auditoria Nº ${latest.audit_number} em aberto encontrada e carregada.`);
          } else {
            // Auditoria anterior fechada -> Próxima
            setAuditNumber(latest.audit_number + 1);
            alert(`Última auditoria (Nº ${latest.audit_number}) finalizada em ${new Date(latest.updated_at!).toLocaleDateString()}. Preparando Auditoria Nº ${latest.audit_number + 1}.`);
            setData(null);
          }
        } else {
          // Nenhuma auditoria
          setAuditNumber(1);
          setData(null);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessing(false);
      }
    };
    loadSession();
  }, [selectedFilial]);

  // Remover localStorage effect antigo
  // useEffect(() => { ... }, []); 

  // Auto-save no Supabase
  useEffect(() => {
    if (!data || !selectedFilial) return;

    const timer = setTimeout(async () => {
      // Calcular progresso
      let skus = 0, doneSkus = 0;
      data.groups.forEach(g => g.departments.forEach(d => d.categories.forEach(c => {
        skus += c.itemsCount;
        if (c.status === AuditStatus.DONE) doneSkus += c.itemsCount;
      })));
      const progress = skus > 0 ? (doneSkus / skus) * 100 : 0;

      await upsertAuditSession({
        id: dbSessionId,
        branch: selectedFilial,
        audit_number: auditNumber,
        status: progress >= 100 ? 'completed' : 'open', // Atenção: só marca completed se o usuário finalizar explicitamente? Por enquanto automático ou status 'open' e usuário clica check
        data: data,
        progress: progress
      });
      // console.log("Auto-saved to Supabase");
    }, 2000); // 2s debounce

    return () => clearTimeout(timer);
  }, [data, selectedFilial, auditNumber, dbSessionId]);

  useEffect(() => {
    if (data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [data]);

  const handleReset = () => {
    if (window.confirm("Atenção! Isso apagará todo o progresso atual para iniciar uma nova auditoria/filial. Confirmar?")) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.clear(); // Limpa todas as chaves para garantir
      setData(null);
      setSelectedFilial("");
      setFileGroups(null);
      setFileStock(null);
      setFileDeptIds(null);
      setFileCatIds(null);
      setInitialDoneUnits(0);
      setSessionStartTime(Date.now());
      setView({ level: 'groups' });
      // Força o reload para limpar estados globais e referências de arquivos
      window.location.reload();
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
          // @ts-ignore
          const workbook = window.XLSX.read(ab, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          // @ts-ignore
          const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
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

    // Se já temos dados carregados do banco (retomada), não precisamos dos arquivos
    if (data && data.groups.length > 0) {
      // Já carregado no useEffect
      return;
    }

    if (!fileGroups || !fileStock || !fileDeptIds || !fileCatIds) {
      alert("Por favor, carregue todos os arquivos para iniciar uma nova auditoria.");
      return;
    }

    setIsProcessing(true);
    try {
      const rowsGroups = await readExcel(fileGroups);
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
                status: AuditStatus.TODO,
                products: []
              };
              dept.categories.push(cat);
            } else if (!cat.numericId && resolvedCatId) cat.numericId = resolvedCatId;

            cat.itemsCount++;
            cat.totalQuantity += stockQty;
            cat.products.push({ code: barcode, name: productName, quantity: stockQty });
          }
        }
      });

      const newData: AuditData = {
        groups: Object.values(groupsMap).sort((a, b) => parseInt(a.id.split('+')[0]) - parseInt(b.id.split('+')[0])),
        empresa: selectedEmpresa,
        filial: selectedFilial,
        auditNumber: auditNumber
      };

      // Salvar inicial no banco para gerar ID
      const savedSession = await upsertAuditSession({
        branch: selectedFilial,
        audit_number: auditNumber,
        status: 'open',
        data: newData,
        progress: 0
      });

      if (savedSession && savedSession.id) {
        setDbSessionId(savedSession.id);
        newData.sessionId = savedSession.id;
      }

      setData(newData);
      setView({ level: 'groups' });
    } catch (err) { alert("Erro ao processar arquivos."); console.error(err); }
    finally { setIsProcessing(false); }
  };

  const handleLoadFromTrier = async () => {
    if (!selectedFilial) {
      alert("Selecione a filial antes de carregar do Trier.");
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
      setData(payload);
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
    if (!data) return { skus: 0, units: 0, doneSkus: 0, doneUnits: 0, progress: 0, pendingUnits: 0, pendingSkus: 0, totalCategories: 0, doneCategories: 0 };
    let skus = 0, units = 0, doneSkus = 0, doneUnits = 0, totalCats = 0, doneCats = 0;
    data.groups.forEach(g => g.departments.forEach(d => d.categories.forEach(c => {
      skus += c.itemsCount;
      units += c.totalQuantity;
      totalCats++;
      if (c.status === AuditStatus.DONE) {
        doneSkus += c.itemsCount;
        doneUnits += c.totalQuantity;
        doneCats++;
      }
    })));
    return {
      skus, units, doneSkus, doneUnits,
      pendingUnits: units - doneUnits,
      pendingSkus: skus - doneSkus,
      totalCategories: totalCats,
      doneCategories: doneCats,
      progress: skus > 0 ? (doneSkus / skus) * 100 : 0,
      progressUnits: units > 0 ? (doneUnits / units) * 100 : 0
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
    let skus = 0, units = 0, doneSkus = 0, doneUnits = 0;
    const cats = 'departments' in scope ? scope.departments.flatMap(d => d.categories) : scope.categories;
    cats.forEach(c => {
      skus += c.itemsCount;
      units += c.totalQuantity;
      if (c.status === AuditStatus.DONE) {
        doneSkus += c.itemsCount;
        doneUnits += c.totalQuantity;
      }
    });
    return {
      skus, units, doneSkus, doneUnits,
      pendingUnits: units - doneUnits,
      pendingSkus: skus - doneSkus,
      progress: skus > 0 ? (doneSkus / skus) * 100 : 0,
      progressUnits: units > 0 ? (doneUnits / units) * 100 : 0
    };
  };

  const buildTermKey = (scope: TermScope) => {
    return [scope.type, scope.groupId, scope.deptId || '', scope.catId || ''].join('|');
  };

  const createDefaultTermForm = (): TermForm => ({
    inventoryNumber: '',
    date: new Date().toLocaleDateString('pt-BR'),
    managerName: '',
    managerCpf: '',
    collaborators: Array.from({ length: 10 }, () => ({ name: '', cpf: '', signature: '' }))
  });

  const openTermModal = (scope: TermScope) => {
    const key = buildTermKey(scope);
    setTermModal(scope);
    setTermForm(termDrafts[key] || createDefaultTermForm());
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
    const products: { groupName: string; deptName: string; catName: string; code: string; name: string; quantity: number }[] = [];

    if (scope.type === 'group') {
      departments = group.departments;
      categories = group.departments.flatMap(d => d.categories);
      group.departments.forEach(d => {
        d.categories.forEach(c => {
          c.products.forEach(p => {
            products.push({ groupName: group.name, deptName: d.name, catName: c.name, code: p.code, name: p.name, quantity: p.quantity });
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
            products.push({ groupName: group.name, deptName: dept!.name, catName: c.name, code: p.code, name: p.name, quantity: p.quantity });
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
          products.push({ groupName: group.name, deptName: dept!.name, catName: cat!.name, code: p.code, name: p.name, quantity: p.quantity });
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
    const { jsPDF } = window.jspdf || {};
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
        termForm.managerName ? `Gestor: ${termForm.managerName}` : 'Gestor',
        termForm.managerCpf || '',
        '________________________'
      ],
      ...(termForm.collaborators.length ? termForm.collaborators : Array.from({ length: 10 }, () => ({ name: '', cpf: '', signature: '' }))).map(c => [
        c.name || 'Colaborador',
        c.cpf || '',
        c.signature || '________________________'
      ])
    ];

    // @ts-ignore
    doc.autoTable({
      startY: y,
      head: [['Responsável', 'CPF', 'Ass.']],
      body: signatureRows,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] }
    });

    // @ts-ignore
    const afterSignY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 6 : y + 20;

    const productRows = scopeInfo.products.map(p => [
      p.groupName,
      p.deptName,
      p.catName,
      p.code,
      p.name,
      Math.round(p.quantity).toLocaleString()
    ]);

    // @ts-ignore
    doc.autoTable({
      startY: afterSignY,
      head: [['Grupo', 'Departamento', 'Categoria', 'Código', 'Produto', 'Qtd']],
      body: productRows,
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] }
    });

    const safeName = scopeInfo.group.name.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 30);
    const fileName = `Termo_Auditoria_F${data.filial}_${termModal.type}_${safeName}.pdf`;
    doc.save(fileName);
  };

  const toggleScopeStatus = (groupId?: string, deptId?: string, catId?: string) => {
    if (!data) return;
    setData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        groups: prev.groups.map(g => {
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
    });
  };

  const handleExportPDF = async () => {
    if (!data) return;
    // @ts-ignore
    const { jsPDF } = window.jspdf;
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
      ["SKUs FALTANTES", branchMetrics.pendingSkus.toLocaleString(), "UNIDADES FALTANTES", Math.round(branchMetrics.pendingUnits).toLocaleString()]
    ];
    // @ts-ignore
    doc.autoTable({ startY: 40, body: summaryData, theme: 'grid', styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [79, 70, 229] } });

    doc.addPage();
    doc.setFontSize(16); doc.setTextColor(15, 23, 42);
    doc.text("BALANÇO ANALÍTICO HIERÁRQUICO (TOTAL vs CONFERIDO)", 14, 20);

    const hierarchyRows: any[] = [];
    data.groups.forEach(g => {
      const gm = calcScopeMetrics(g);
      hierarchyRows.push([
        { content: `GRUPO: ${g.name} (ID ${g.id})`, styles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' } },
        gm.skus, gm.doneSkus, gm.pendingSkus, `${Math.round(gm.progress)}%`,
        Math.round(gm.units).toLocaleString(), Math.round(gm.doneUnits).toLocaleString(), Math.round(gm.pendingUnits).toLocaleString(), `${Math.round(gm.progressUnits)}%`
      ]);

      g.departments.forEach(d => {
        const dm = calcScopeMetrics(d);
        hierarchyRows.push([
          { content: `  > DEPARTAMENTO: ${d.name} (${d.numericId || '--'})`, styles: { fillColor: [241, 245, 249], fontStyle: 'bold' } },
          dm.skus, dm.doneSkus, dm.pendingSkus, `${Math.round(dm.progress)}%`,
          Math.round(dm.units).toLocaleString(), Math.round(dm.doneUnits).toLocaleString(), Math.round(dm.pendingUnits).toLocaleString(), `${Math.round(dm.progressUnits)}%`
        ]);

        d.categories.forEach(c => {
          const isDone = c.status === AuditStatus.DONE;
          hierarchyRows.push([
            `      - ${c.name} (${c.numericId || "--"})`,
            c.itemsCount, isDone ? c.itemsCount : 0, isDone ? 0 : c.itemsCount, isDone ? "100%" : "0%",
            c.totalQuantity.toLocaleString(), isDone ? c.totalQuantity.toLocaleString() : "0", isDone ? "0" : c.totalQuantity.toLocaleString(), isDone ? "100%" : "0%"
          ]);
        });
      });
    });

    // @ts-ignore
    doc.autoTable({
      startY: 25,
      head: [['ESTRUTURA', 'MIX TOT', 'MIX AUD', 'MIX FALT', '% MIX', 'UNID TOT', 'UNID AUD', 'UNID FALT', '% UNID']],
      body: hierarchyRows,
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [15, 23, 42] }
    });

    doc.save(`Auditoria_F${data.filial}_Analitica.pdf`);
  };

  const selectedGroup = useMemo(() => data?.groups.find(g => g.id === view.selectedGroupId), [data, view.selectedGroupId]);
  const selectedDept = useMemo(() => selectedGroup?.departments.find(d => d.id === view.selectedDeptId), [selectedGroup, view.selectedDeptId]);
  const selectedCat = useMemo(() => selectedDept?.categories.find(c => c.id === view.selectedCatId), [selectedDept, view.selectedCatId]);
  const termScopeInfo = useMemo(() => (termModal ? buildTermScopeInfo(termModal) : null), [termModal, data]);

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
        <div className="max-w-2xl w-full bg-white rounded-[2rem] shadow-2xl overflow-hidden">
          <div className="bg-indigo-600 p-10 text-center text-white">
            <h1 className="text-4xl font-black italic tracking-tighter">AuditFlow</h1>
            <p className="text-indigo-200 text-[10px] uppercase font-bold tracking-widest mt-1 italic">Sistema de Auditoria Master</p>
          </div>
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-[10px] font-black uppercase text-slate-400">Empresa</label><select className="w-full bg-slate-50 border-2 rounded-xl px-4 py-3 font-bold border-slate-100" value={selectedEmpresa} onChange={e => setSelectedEmpresa(e.target.value)}><option>Drogaria Cidade</option></select></div>
              <div className="space-y-1"><label className="text-[10px] font-black uppercase text-slate-400">Selecione a Filial</label><select className="w-full bg-slate-50 border-2 rounded-xl px-4 py-3 font-bold border-slate-100" value={selectedFilial} onChange={e => setSelectedFilial(e.target.value)}><option value="">Selecione...</option>{FILIAIS.map(f => <option key={f} value={f.toString()}>Filial {f}</option>)}</select></div>
            </div>
<<<<<<< Updated upstream
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[ { f: fileGroups, set: setFileGroups, label: 'Estrutura' }, { f: fileStock, set: setFileStock, label: 'Saldos' }, { f: fileDeptIds, set: setFileDeptIds, label: 'IDs Depto' }, { f: fileCatIds, set: setFileCatIds, label: 'IDs Cat' } ].map((item, i) => (
=======
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[{ f: fileGroups, set: setFileGroups, label: 'Estrutura' }, { f: fileStock, set: setFileStock, label: 'Saldos' }, { f: fileDeptIds, set: setFileDeptIds, label: 'IDs Depto' }, { f: fileCatIds, set: setFileCatIds, label: 'IDs Cat' }].map((item, i) => (
>>>>>>> Stashed changes
                <label key={i} className={`block border-2 border-dashed rounded-xl p-4 cursor-pointer transition-all text-center ${item.f ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 hover:border-indigo-400'}`}>
                  <input type="file" className="hidden" onChange={e => item.set(e.target.files?.[0] || null)} />
                  <i className={`fa-solid fa-file-excel text-xl mb-1 ${item.f ? 'text-emerald-500' : 'text-slate-300'}`}></i>
                  <p className="text-[8px] font-black uppercase truncate">{item.f ? item.f.name : item.label}</p>
                </label>
              ))}
      </div>
      <div className="space-y-3">
        <button onClick={handleStartAudit} disabled={isProcessing} className="w-full py-4 rounded-xl bg-slate-900 text-white font-black uppercase tracking-widest hover:bg-indigo-600 transition-all shadow-xl active:scale-95">
          {isProcessing ? 'Sincronizando Banco de Dados...' : 'Iniciar Inventário Master'}
        </button>
        <button onClick={handleLoadFromTrier} disabled={isTrierLoading} className="w-full py-4 rounded-xl bg-emerald-600 text-white font-black uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2">
          <i className="fa-solid fa-bolt"></i>
          {isTrierLoading ? 'Carregando do Trier...' : 'Carregar direto do Trier (tempo real)'}
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
    <div className="min-h-screen bg-[#f1f5f9] pb-32 font-sans">
      <header className="bg-slate-900 text-white sticky top-0 z-[1002] px-8 py-3 shadow-xl flex justify-between items-center border-b border-white/5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg rotate-2"><i className="fa-solid fa-clipboard-list"></i></div>
            <h1 className="text-xl font-black italic tracking-tighter leading-none">AuditFlow</h1>
          </div>
          <div className="h-8 w-px bg-white/10 mx-2"></div>
          {/* Badge Vistoso da Filial */}
          <div className="flex items-center bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-900 px-8 py-2.5 rounded-2xl border-2 border-indigo-400/50 shadow-[0_8px_25px_rgba(79,70,229,0.5)] transform hover:scale-105 transition-transform duration-300">
            <div className="flex flex-col">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-indigo-300 leading-none mb-1">AUDITANDO AGORA</span>
              <span className="text-2xl font-black italic tracking-tighter leading-tight text-white drop-shadow-md">
                FILIAL UNIDADE F{data.filial} <span className="text-sm text-indigo-300 ml-2 not-italic">#{data.auditNumber || auditNumber}</span>
              </span>
            </div>
            <div className="ml-6 flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_#34d399]"></div>
              <span className="text-[8px] font-bold text-emerald-400 mt-1 uppercase">LIVE</span>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExportPDF} className="bg-white/10 hover:bg-white/20 px-5 py-2 rounded-xl text-white font-black text-[9px] uppercase tracking-widest flex items-center gap-2 transition-all border border-white/10"><i className="fa-solid fa-file-export"></i> PDF ANALÍTICO</button>
          <button onClick={handleReset} className="w-10 h-10 rounded-xl bg-red-600/20 text-red-500 border border-red-500/30 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all shadow-lg active:scale-90"><i className="fa-solid fa-power-off"></i></button>
        </div>
      </header>

      {/* Dashboard de Comando Superior v7.1 */}
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

          {/* SKUs TOTAIS */}
          <div className="flex flex-col items-center border-l border-slate-100 px-2">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">SKUs Totais</span>
            <span className="text-2xl font-black text-slate-900 tabular-nums leading-none mt-1">{branchMetrics.skus.toLocaleString()}</span>
            <span className="text-[8px] font-bold text-slate-400 uppercase mt-1 tracking-tighter">MIX IMPORTADO</span>
          </div>

          {/* UNIDADES TOTAIS - ATUALIZADO COM CONFERIDO */}
          <div className="flex flex-col items-center border-l border-slate-100 px-2">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Unidades Totais</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-black text-indigo-700 tabular-nums">{Math.round(branchMetrics.doneUnits).toLocaleString()}</span>
              <span className="text-slate-200 text-sm">/</span>
              <span className="text-lg font-black text-slate-300 tabular-nums">{Math.round(branchMetrics.units).toLocaleString()}</span>
            </div>
            <span className="text-[8px] font-bold text-indigo-300 uppercase mt-1 tracking-tighter">CONFERIDAS / TOTAIS</span>
          </div>

          {/* MIX AUDITADO */}
          <div className="flex flex-col items-center border-l border-slate-100 px-2">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic text-center">Mix Auditado</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-black text-emerald-600 tabular-nums">{branchMetrics.doneSkus.toLocaleString()}</span>
              <span className="text-slate-200 text-sm">/</span>
              <span className="text-lg font-black text-slate-300 tabular-nums">{branchMetrics.pendingSkus.toLocaleString()}</span>
            </div>
            <span className="text-[8px] font-bold text-emerald-500 uppercase mt-1 tracking-tighter">CONFERIDOS / PENDENTES</span>
          </div>

          {/* PREVISÃO FINAL */}
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
          onNavigate={l => setView(prev => ({ ...prev, level: l as any }))}
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
                        className={`px-3 h-10 rounded-xl border flex items-center justify-center gap-1 transition-all shadow-sm text-[10px] font-black uppercase ${isComplete
                            ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-600 hover:text-white'
                            : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                          }`}
                        title={isComplete ? 'Assinar e imprimir termo' : 'Conclua 100% para liberar'}
                      >
                        <i className="fa-solid fa-file-signature text-[11px]"></i>
                        Termo
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); toggleScopeStatus(group.id); }} className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all shadow-sm"><i className="fa-solid fa-check-double text-sm"></i></button>
                      <button onClick={() => setView({ level: 'departments', selectedGroupId: group.id })} className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center hover:bg-indigo-600 transition-all shadow-md"><i className="fa-solid fa-chevron-right text-sm"></i></button>
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
                        className={`px-4 py-2 min-w-[76px] rounded-xl text-[10px] font-black uppercase transition-all shadow-sm ${isComplete
                            ? 'bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-600 hover:text-white'
                            : 'bg-slate-100 text-slate-300 border border-slate-200 cursor-not-allowed'
                          }`}
                        title={isComplete ? 'Assinar e imprimir termo' : 'Conclua 100% para liberar'}
                      >
                        Termo
                      </button>
                      <button onClick={() => toggleScopeStatus(selectedGroup?.id, dept.id)} className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-black uppercase hover:bg-emerald-600 hover:text-white transition-all shadow-sm">Alternar Tudo</button>
                      <button onClick={() => setView(prev => ({ ...prev, level: 'categories', selectedDeptId: dept.id }))} className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center hover:bg-indigo-600 transition-all shadow-lg"><i className="fa-solid fa-chevron-right text-sm"></i></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-8 mb-6">
                    <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Mix Total</span><span className="text-lg font-black text-slate-400">{m.skus}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Mix Auditado</span><span className="text-xl font-black text-emerald-600 tabular-nums">{m.doneSkus}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Unid Totais</span><span className="text-lg font-black text-slate-400">{Math.round(m.units).toLocaleString()}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] font-black text-slate-400 uppercase italic mb-1">Unid Auditadas</span><span className="text-xl font-black text-indigo-600 tabular-nums">{Math.round(m.doneUnits).toLocaleString()}</span></div>
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
                  </div>
                </div>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => { if (cat.status === AuditStatus.DONE) openTermModal({ type: 'category', groupId: selectedGroup!.id, deptId: selectedDept!.id, catId: cat.id }); }}
                  disabled={cat.status !== AuditStatus.DONE}
                  className={`px-6 py-4 rounded-xl text-[10px] font-black uppercase transition-all border shadow-sm ${cat.status === AuditStatus.DONE
                      ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:text-white hover:bg-indigo-600'
                      : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                    }`}
                >
                  Termo
                </button>
                <button onClick={() => setView(prev => ({ ...prev, level: 'products', selectedCatId: cat.id }))} className="px-6 py-4 rounded-xl bg-slate-50 text-slate-400 text-[10px] font-black uppercase hover:text-indigo-600 hover:bg-white transition-all border border-transparent hover:border-indigo-100 shadow-sm">Detalhar</button>
                <button onClick={() => toggleScopeStatus(selectedGroup?.id, selectedDept?.id, cat.id)} className={`px-10 py-4 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all shadow-md active:scale-95 ${cat.status === AuditStatus.DONE ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-indigo-600'}`}>{cat.status === AuditStatus.DONE ? 'CONCLUÍDO' : 'FINALIZAR'}</button>
              </div>
            </div>
          ))}

          {view.level === 'products' && selectedCat && (
            <div className="bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200">
              <div className="bg-slate-900 p-10 text-white flex justify-between items-center relative">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                  <i className="fa-solid fa-boxes-stacked text-8xl"></i>
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
                    className={`px-6 py-5 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl transition-all active:scale-95 border ${selectedCat.status === AuditStatus.DONE
                        ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-600 hover:text-white'
                        : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                      }`}
                  >
                    Imprimir Termo
                  </button>
                  <button onClick={() => toggleScopeStatus(selectedGroup?.id, selectedDept?.id, selectedCat.id)} className={`px-10 py-5 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] shadow-2xl transition-all active:scale-95 border-b-4 ${selectedCat.status === AuditStatus.DONE ? 'bg-emerald-600 border-emerald-800' : 'bg-indigo-600 border-indigo-800 hover:bg-indigo-500'}`}>
                    {selectedCat.status === AuditStatus.DONE ? 'REABRIR CATEGORIA' : 'CONCLUIR AUDITORIA'}
                  </button>
                </div>
              </div>
              <div className="max-h-[650px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-md z-20 border-b shadow-sm"><tr className="border-b border-slate-100"><th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 tracking-widest italic">Cód. de Barras</th><th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 tracking-widest italic">Descrição Analítica do Item</th><th className="px-12 py-6 text-[11px] font-black uppercase text-slate-400 text-right tracking-widest italic">Saldo Importado</th></tr></thead>
                  <tbody>{selectedCat.products.map((p, i) => (<tr key={i} className="border-b border-slate-50 hover:bg-indigo-50/50 transition-colors group"><td className="px-12 py-4 text-sm font-bold text-slate-500 tabular-nums">{p.code}</td><td className="px-12 py-4 text-sm font-black uppercase italic leading-tight text-slate-800 group-hover:text-indigo-600 transition-colors">{p.name}</td><td className="px-12 py-4 text-3xl font-black text-right tabular-nums group-hover:scale-105 transition-transform">{p.quantity.toLocaleString()}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {view.level !== 'groups' && (
        <button onClick={() => setView(prev => ({ ...prev, level: prev.level === 'products' ? 'categories' : prev.level === 'categories' ? 'departments' : 'groups' }))} className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-16 py-6 rounded-full shadow-[0_25px_60px_rgba(0,0,0,0.4)] font-black text-[14px] uppercase tracking-[0.3em] hover:bg-indigo-600 hover:scale-110 active:scale-95 transition-all z-[2002] border-8 border-[#f1f5f9] flex items-center gap-6 group">
          <i className="fa-solid fa-arrow-left-long transition-transform group-hover:-translate-x-3"></i> Retornar Nível
        </button>
      )}

      {termModal && termForm && termScopeInfo && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[2005] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest flex items-center gap-2">
                <i className="fa-solid fa-file-signature text-indigo-500"></i>
                Termo de Auditoria - {termModal.type === 'group' ? 'Grupo' : termModal.type === 'department' ? 'Departamento' : 'Categoria'}
              </h3>
              <button onClick={() => { setTermModal(null); setTermForm(null); }} className="text-slate-400 hover:text-red-500 transition-colors">
                <i className="fa-solid fa-xmark"></i>
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
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700"
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</label>
                  <input
                    type="text"
                    value={termForm.date}
                    onChange={(e) => updateTermForm(prev => ({ ...prev, date: e.target.value }))}
                    placeholder="DD/MM/AAAA"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700"
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gestor</label>
                  <input
                    type="text"
                    value={termForm.managerName}
                    onChange={(e) => updateTermForm(prev => ({ ...prev, managerName: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700"
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CPF Gestor</label>
                  <input
                    type="text"
                    value={termForm.managerCpf}
                    onChange={(e) => updateTermForm(prev => ({ ...prev, managerCpf: e.target.value }))}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm text-slate-700"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Colaboradores</h4>
                  <button
                    onClick={() => updateTermForm(prev => ({ ...prev, collaborators: [...prev.collaborators, { name: '', cpf: '', signature: '' }] }))}
                    className="text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-lg hover:bg-indigo-600 hover:text-white transition-all"
                  >
                    + Adicionar
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {termForm.collaborators.map((collab, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        type="text"
                        value={collab.name}
                        onChange={(e) => updateTermForm(prev => ({
                          ...prev,
                          collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, name: e.target.value } : c)
                        }))}
                        placeholder="Colaborador"
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-xs text-slate-700"
                      />
                      <input
                        type="text"
                        value={collab.cpf}
                        onChange={(e) => updateTermForm(prev => ({
                          ...prev,
                          collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, cpf: e.target.value } : c)
                        }))}
                        placeholder="CPF"
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-xs text-slate-700"
                      />
                      <input
                        type="text"
                        value={collab.signature}
                        onChange={(e) => updateTermForm(prev => ({
                          ...prev,
                          collaborators: prev.collaborators.map((c, i) => i === idx ? { ...c, signature: e.target.value } : c)
                        }))}
                        placeholder="Ass."
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-xs text-slate-700"
                      />
                    </div>
                  ))}
                </div>
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

export default App;
