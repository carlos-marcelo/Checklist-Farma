
import { GoogleGenAI } from "@google/genai";
import { AuditData, AuditStatus } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getAuditInsights = async (data: AuditData): Promise<string> => {
  try {
    const summary = data.groups.map(g => {
        const totalCats = g.departments.reduce((acc, d) => acc + d.categories.length, 0);
        // Fixed: Use AuditStatus.DONE instead of the string 'done' to match the AuditStatus type
        const doneCats = g.departments.reduce((acc, d) => acc + d.categories.filter(c => c.status === AuditStatus.DONE).length, 0);
        return `Grupo ${g.id} (${g.name}): ${doneCats}/${totalCats} categorias concluídas.`;
    }).join('\n');

    const prompt = `
      Atue como um especialista em auditoria de estoque de farmácia. 
      Analise o seguinte estado da auditoria atual e forneça um resumo motivacional curto (máximo 3 frases) em português. 
      Destaque o que falta e sugira uma prioridade para o auditor.

      Estado da Auditoria:
      ${summary}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Não foi possível gerar insights no momento.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Mantenha o foco! A precisão do estoque é a alma do negócio.";
  }
};
