
import { AuditData, AuditStatus } from './types';

// Adding the missing properties (empresa and filial) to satisfy the AuditData interface requirements
export const INITIAL_AUDIT_DATA: AuditData = {
  groups: [
    {
      id: "8000",
      name: "Higiene e Beleza",
      departments: [
        {
          id: "01",
          name: "Perfumaria",
          categories: [
            // Added products: [] to satisfy the Category interface requirement
            { id: "8000-01-cat1", name: "Cabelos", itemsCount: 120, totalQuantity: 1200, status: AuditStatus.TODO, products: [] },
            // Added products: [] to satisfy the Category interface requirement
            { id: "8000-01-cat2", name: "Pele", itemsCount: 80, totalQuantity: 800, status: AuditStatus.TODO, products: [] },
            // Added products: [] to satisfy the Category interface requirement
            { id: "8000-01-cat3", name: "Maquiagem", itemsCount: 45, totalQuantity: 450, status: AuditStatus.DONE, products: [] },
          ]
        },
        {
          id: "07",
          name: "Banho",
          categories: [
            // Added products: [] to satisfy the Category interface requirement
            { id: "8000-07-cat1", name: "Sabonetes", itemsCount: 200, totalQuantity: 2000, status: AuditStatus.TODO, products: [] },
          ]
        }
      ]
    },
    {
      id: "10000",
      name: "Conveniência",
      departments: [
        {
          id: "02",
          name: "Alimentos",
          categories: [
            // Added products: [] to satisfy the Category interface requirement
            { id: "10000-02-cat1", name: "Doces", itemsCount: 60, totalQuantity: 600, status: AuditStatus.TODO, products: [] },
            // Added products: [] to satisfy the Category interface requirement
            { id: "10000-02-cat2", name: "Bebidas", itemsCount: 150, totalQuantity: 1500, status: AuditStatus.TODO, products: [] },
          ]
        }
      ]
    },
    {
      id: "3000",
      name: "Medicamentos RX",
      departments: [
        {
          id: "03",
          name: "Éticos",
          categories: [
            // Added products: [] to satisfy the Category interface requirement
            { id: "3000-03-cat1", name: "Uso contínuo", itemsCount: 90, totalQuantity: 900, status: AuditStatus.DONE, products: [] },
            // Added products: [] to satisfy the Category interface requirement
            { id: "3000-03-cat2", name: "Antibióticos", itemsCount: 40, totalQuantity: 400, status: AuditStatus.TODO, products: [] },
          ]
        }
      ]
    },
    {
      id: "2000",
      name: "Medicamentos Similar",
      departments: [
        {
          id: "04",
          name: "Similar",
          categories: [
            // Added products: [] to satisfy the Category interface requirement
            { id: "2000-04-cat1", name: "Analgésicos", itemsCount: 70, totalQuantity: 700, status: AuditStatus.TODO, products: [] },
          ]
        }
      ]
    },
    {
      id: "4000",
      name: "Medicamentos Genérico",
      departments: [
        {
          id: "05",
          name: "Genérico",
          categories: [
            // Added products: [] to satisfy the Category interface requirement
            { id: "4000-05-cat1", name: "Antiinflamatórios", itemsCount: 110, totalQuantity: 1100, status: AuditStatus.TODO, products: [] },
          ]
        }
      ]
    },
    {
      id: "67+66",
      name: "Genérico + Similar sem margem",
      departments: [
        {
          id: "06",
          name: "Sem Margem",
          categories: [
            // Added products: [] to satisfy the Category interface requirement
            { id: "67-06-cat1", name: "Preço controlado", itemsCount: 50, totalQuantity: 500, status: AuditStatus.DONE, products: [] },
          ]
        }
      ]
    }
  ],
  empresa: "Drogaria Cidade",
  filial: "1"
};