export enum InputType {
  TEXT = 'TEXT',
  TEXTAREA = 'TEXTAREA',
  DATE = 'DATE', // Custom Day/Month/Year picker
  BOOLEAN_PASS_FAIL = 'BOOLEAN_PASS_FAIL', // Sim/Não
  RATING_10 = 'RATING_10', // 0-10
  HEADER = 'HEADER', // Section header
  INFO = 'INFO', // Informational text
}

export interface ChecklistItem {
  id: string;
  text: string;
  type: InputType;
  required?: boolean;
  helpText?: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistDefinition {
  id: string;
  title: string;
  description: string;
  sections: ChecklistSection[];
}

export interface ChecklistData {
  [key: string]: string | number | boolean | null;
}

export interface ChecklistImages {
  [key: string]: string[]; // Array of base64 strings
}