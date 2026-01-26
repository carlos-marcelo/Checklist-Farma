
import { Product, PVRecord, SalesRecord, DCBReportRecord } from './types';

declare const XLSX: any;

/**
 * Normaliza códigos reduzidos para evitar erros de tipo (string vs number) e espaços
 */
const normalizeCode = (code: any): string => {
  if (code === null || code === undefined) return "";
  const cleaned = String(code).trim();
  // Se for apenas zeros, mantém um zero, senão remove zeros à esquerda
  return cleaned === "0" ? "0" : cleaned.replace(/^0+/, '');
};

export const parseProductsXML = (xmlText: string): Product[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const products: Product[] = [];
  
  const items = xmlDoc.getElementsByTagName("produto");
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    products.push({
      id: item.getElementsByTagName("id")[0]?.textContent || Math.random().toString(),
      name: item.getElementsByTagName("nome")[0]?.textContent || "Produto sem nome",
      barcode: item.getElementsByTagName("cod_barras")[0]?.textContent || "",
      reducedCode: normalizeCode(item.getElementsByTagName("cod_reduzido")[0]?.textContent),
      dcb: item.getElementsByTagName("dcb")[0]?.textContent || "N/A"
    });
  }
  return products;
};

export const parseSystemProductsXLSX = async (file: File): Promise<Product[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const products: Product[] = [];
        
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 3) continue;

          // Col C (2) = Reduzido, Col D (3) = Descrição, Col K (10) = Barras
          const reducedCode = normalizeCode(row[2]);
          const name = String(row[3] || "").trim();
          const barcode = String(row[10] || "").trim();

          if (reducedCode !== "" && !isNaN(Number(reducedCode))) {
            products.push({
              id: `sys-${reducedCode}-${i}`,
              name: name || "Produto sem descrição",
              barcode: barcode,
              reducedCode: reducedCode,
              dcb: "N/A"
            });
          }
        }
        resolve(products);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

export const parseDCBProductsXLSX = async (file: File): Promise<Product[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellText: true, cellNF: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        const products: Product[] = [];
        
        let currentDCB = "N/A";

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          let isHeaderRow = false;
          // Identifica o cabeçalho DCB (Ex: "DCB" na coluna B, Código na C, Descrição na D)
          for (let c = 0; c < Math.min(row.length, 5); c++) {
            const val = String(row[c] || "").trim().toUpperCase();
            if (val.includes("DCB") && !/^\d+$/.test(val.replace("DCB", "").trim())) {
              const dcbCode = String(row[c+1] || "").trim();
              const dcbDesc = String(row[c+2] || "").trim();
              
              if (dcbCode) {
                currentDCB = dcbCode + (dcbDesc ? ` - ${dcbDesc}` : "");
              } else {
                currentDCB = val.replace("DCB:", "").replace("DCB", "").trim() || currentDCB;
              }
              
              isHeaderRow = true;
              break;
            }
          }
          if (isHeaderRow) continue;

          let reducedCode = "";
          let productName = "";
          
          for (let c = 0; c < Math.min(row.length, 3); c++) {
            const val = String(row[c] || "").trim();
            if (/^\d+$/.test(val) && val !== "") {
              reducedCode = normalizeCode(val);
              productName = String(row[c+1] || row[c+2] || "").trim();
              break;
            }
          }

          if (reducedCode && productName.length > 2) {
            products.push({
              id: `dcb-${reducedCode}-${i}`,
              name: productName,
              barcode: "",
              reducedCode: reducedCode,
              dcb: currentDCB
            });
          }
        }
        resolve(products);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

export const parseSalesXLSX = async (file: File): Promise<{sales: SalesRecord[], period: string}> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const sales: SalesRecord[] = [];
        
        // Período na Linha 5 (index 4), Coluna I (index 8)
        let period = "Não identificado";
        if (rows[4] && rows[4][8]) {
          period = String(rows[4][8]).trim();
        }

        let currentSalesperson = "Vendedor não identificado";

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 2) continue;

          let foundVendedorMarker = false;
          let markerIndex = -1;
          for(let c=0; c<3; c++) {
            if(String(row[c] || "").toLowerCase().includes("vendedor")) {
               foundVendedorMarker = true;
               markerIndex = c;
               break;
            }
          }

          if (foundVendedorMarker) {
            const nameCandidates = row.slice(markerIndex + 1)
              .map(val => String(val || "").trim())
              .filter(val => val !== "" && val !== "-" && !val.endsWith("-") && !/^\d+$/.test(val));
            
            if (nameCandidates.length > 0) {
              currentSalesperson = nameCandidates.join(" ").replace(/\s+/g, ' ').trim();
            }
            continue;
          }

          const colBValue = String(row[1] || "").trim();
          const isNumericCode = /^\d+$/.test(colBValue) && colBValue !== "";
          
          if (isNumericCode) {
            const productName = String(row[2] || "").trim();
            const quantity = parseFloat(row[5]) || 0;

            if (quantity > 0) {
              sales.push({ 
                reducedCode: colBValue, 
                productName: productName, 
                quantity: quantity, 
                salesperson: currentSalesperson,
                date: period, 
                dcb: "N/A" 
              });
            }
          }
        }
        resolve({ sales, period });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

export const parseDCBReportXLSX = async (file: File): Promise<DCBReportRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const dcbRecords: DCBReportRecord[] = [];
        
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 3) continue;

          const reducedCode = normalizeCode(row[0]);
          const productName = String(row[1] || "").trim();
          const dcb = String(row[2] || "N/A").trim();
          const soldQuantity = parseFloat(row[3]) || 0;

          if (dcb && dcb.toUpperCase() !== "DCB") {
            dcbRecords.push({ reducedCode, productName, dcb, soldQuantity });
          }
        }
        resolve(dcbRecords);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

export const parseSalesCSV = (csvText: string): SalesRecord[] => {
  const lines = csvText.split('\n');
  const sales: SalesRecord[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 3) {
      const reducedCode = normalizeCode(parts[0]);
      const productName = parts[1]?.trim();
      const quantity = parseFloat(parts[2]) || 0;
      
      if (reducedCode && quantity > 0) {
        sales.push({
          reducedCode,
          productName: productName || "Produto CSV",
          quantity,
          salesperson: parts[3]?.trim() || "S/V",
          date: parts[4]?.trim() || "",
          dcb: parts[5]?.trim() || "N/A"
        });
      }
    }
  }
  return sales;
};
