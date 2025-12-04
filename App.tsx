import React, { useState, useEffect, useRef } from 'react';
import { Camera, FileText, CheckSquare, Printer, Clipboard, Image as ImageIcon, Trash2, Menu, X, ChevronRight, Download, Star, AlertTriangle, CheckCircle, Calculator, AlertCircle, LayoutDashboard, FileCheck, Settings, LogOut, Users, Palette, Upload, Lock, UserPlus, ShieldCheck, History, RotateCcw, Save, Search, Calendar, Eye, Phone, User as UserIcon, Ban, Check, Bell, Filter, UserX, Undo2, ScanSearch, CheckSquare as CheckSquareIcon, Trophy, Frown, PartyPopper, Mail } from 'lucide-react';
import { CHECKLISTS } from './constants';
import { ChecklistData, ChecklistImages, InputType, ChecklistSection } from './types';
import SignaturePad from './components/SignaturePad';
import { supabase } from './supabaseClient';
import * as SupabaseService from './supabaseService';

// --- TYPES & INTERFACES FOR AUTH & CONFIG ---

type ThemeColor = 'red' | 'green' | 'blue' | 'yellow';

interface AppConfig {
  pharmacyName: string;
  logo: string | null;
}

interface User {
  email: string;
  password: string;
  name: string;
  phone: string; 
  role: 'MASTER' | 'USER';
  approved: boolean;
  rejected?: boolean; // New field to handle "Banned/Refused" state
  photo?: string;
  preferredTheme?: ThemeColor; // Individual theme preference
}

interface ReportHistoryItem {
  id: string;
  userEmail: string;
  userName: string;
  date: string; // ISO string
  pharmacyName: string;
  score: string;
  formData: Record<string, ChecklistData>;
  images: Record<string, ChecklistImages>;
  signatures: Record<string, Record<string, string>>;
  ignoredChecklists: string[]; // IDs
}

// Enhanced Themes with gradients and shadows
const THEMES: Record<ThemeColor, { 
    bg: string, 
    bgGradient: string,
    border: string, 
    text: string, 
    ring: string, 
    lightBg: string,
    button: string,
    accent: string
}> = {
  red: { 
      bg: 'bg-red-600', 
      bgGradient: 'bg-gradient-to-br from-red-600 to-red-800',
      border: 'border-red-600', 
      text: 'text-red-700', 
      ring: 'focus:ring-red-500', 
      lightBg: 'bg-red-50',
      button: 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 shadow-lg shadow-red-200',
      accent: 'border-red-500'
  },
  green: { 
      bg: 'bg-emerald-600', 
      bgGradient: 'bg-gradient-to-br from-emerald-600 to-emerald-800',
      border: 'border-emerald-600', 
      text: 'text-emerald-700', 
      ring: 'focus:ring-emerald-500', 
      lightBg: 'bg-emerald-50',
      button: 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-lg shadow-emerald-200',
      accent: 'border-emerald-500'
  },
  blue: { 
      bg: 'bg-blue-600', 
      bgGradient: 'bg-gradient-to-br from-blue-600 to-blue-800',
      border: 'border-blue-600', 
      text: 'text-blue-700', 
      ring: 'focus:ring-blue-500', 
      lightBg: 'bg-blue-50',
      button: 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-200',
      accent: 'border-blue-500'
  },
  yellow: { 
      bg: 'bg-amber-500', 
      bgGradient: 'bg-gradient-to-br from-amber-500 to-amber-700',
      border: 'border-amber-500', 
      text: 'text-amber-700', 
      ring: 'focus:ring-amber-500', 
      lightBg: 'bg-amber-50',
      button: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-200',
      accent: 'border-amber-500'
  },
};

// --- MOCK DATABASE ---
const INITIAL_USERS: User[] = [
  { email: 'asconavietagestor@gmail.com', password: 'marcelo1508', name: 'Marcelo Asconavieta', phone: '99999999999', role: 'MASTER', approved: true, rejected: false },
  { email: 'contato@marcelo.far.br', password: 'marcelo1508', name: 'Contato Marcelo', phone: '99999999999', role: 'MASTER', approved: true, rejected: false },
];

// --- COMPONENTS ---

// Custom MF Shield Logo
const MFLogo = ({ className = "w-12 h-12" }: { className?: string }) => (
  <svg viewBox="0 0 100 120" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gradBlue" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#002b5c" />
        <stop offset="100%" stopColor="#004a8f" />
      </linearGradient>
      <linearGradient id="gradRed" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#8a0000" />
        <stop offset="100%" stopColor="#cc0000" />
      </linearGradient>
    </defs>
    {/* Shield Background Left (Blue) */}
    <path d="M50 115 C20 105 5 80 5 30 L50 10 Z" fill="url(#gradBlue)" />
    {/* Shield Background Right (Red) */}
    <path d="M50 115 C80 105 95 80 95 30 L50 10 Z" fill="url(#gradRed)" />
    
    {/* Stylized M (Left Side) */}
    <path d="M25 40 L25 80 L35 80 L35 55 L50 70 L50 40 L40 40 L40 60 L35 55 L35 40 Z" fill="white" />
    
    {/* Stylized F (Right Side) */}
    <path d="M60 40 L60 80 L70 80 L70 65 L80 65 L80 55 L70 55 L70 50 L85 50 L85 40 Z" fill="white" />
  </svg>
);

// Logo Component (Dynamic Dual Display)
const Logo = ({ config, large = false }: { config: AppConfig, large?: boolean }) => {
  return (
    <div className="flex items-center gap-3">
        {/* System Logo (MF) */}
        <div className={`relative ${large ? 'w-20 h-20' : 'w-10 h-10'} flex-shrink-0 filter drop-shadow-md`}>
            <MFLogo className="w-full h-full" />
        </div>
        
        {/* Divider if pharmacy logo exists */}
        {(config.logo || config.pharmacyName !== 'Marcelo Far') && (
            <div className={`h-8 w-px ${large ? 'bg-gray-300' : 'bg-white/30'} mx-1`}></div>
        )}

        {/* Client/Pharmacy Logo or Name */}
        <div className="flex items-center gap-3">
             {config.logo && (
                 <div className={`${large ? 'h-20 w-auto' : 'h-10 w-auto'} bg-white rounded-md p-1 shadow-sm`}>
                    <img src={config.logo} alt="Pharmacy Logo" className="h-full w-auto object-contain" />
                 </div>
             )}
             
             {(!config.logo || large) && (
                 <div className={`flex flex-col justify-center ${large ? 'text-gray-800' : 'text-white'}`}>
                     <span className={`font-black ${large ? 'text-2xl' : 'text-base'} uppercase tracking-tight leading-none`}>
                        {config.pharmacyName}
                     </span>
                     {config.pharmacyName === 'Marcelo Far' && (
                        <span className={`text-[10px] font-bold uppercase tracking-widest opacity-80 ${large ? 'text-gray-500' : 'text-white'}`}>
                            Gestão & Excelência
                        </span>
                     )}
                 </div>
             )}
        </div>
    </div>
  );
};

// Print Logo
const LogoPrint = ({ config, theme }: { config: AppConfig, theme: any }) => {
    return (
        <div className={`flex items-center justify-between mb-8 pb-6 border-b-4 ${theme.border}`}>
            {/* Left: Client Logo */}
            <div className="flex items-center gap-4">
                 {config.logo ? (
                     <img src={config.logo} alt="Logo" className="h-28 w-auto object-contain" />
                 ) : (
                     <div className="w-24 h-24 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 font-bold border-2 border-dashed border-gray-300">LOGO</div>
                 )}
                 <div>
                    <div className={`font-black text-lg leading-tight uppercase tracking-wide ${theme.text}`}>
                        {config.pharmacyName}
                    </div>
                    <div className="text-gray-500 font-bold tracking-wide text-[10px] mt-1">RELATÓRIO DE AVALIAÇÃO</div>
                </div>
            </div>

            {/* Right: System Logo */}
            <div className="flex flex-col items-end opacity-60">
                <div className="w-12 h-12">
                     <MFLogo className="w-full h-full" />
                </div>
                <div className="text-[10px] font-bold uppercase text-gray-500 mt-1">System by Marcelo Far</div>
            </div>
        </div>
    );
};

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

  const days = Array.from({length: 31}, (_, i) => (i + 1).toString().padStart(2, '0'));
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const years = Array.from({length: 10}, (_, i) => (new Date().getFullYear() - 1 + i).toString());

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
          {months.map((m, i) => <option key={m} value={(i+1).toString().padStart(2, '0')}>{m}</option>)}
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
  onRegister 
}: { 
  onLogin: (u: User) => void, 
  users: User[], 
  onRegister: (u: User) => void 
}) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [success, setSuccess] = useState('');
  const [shakeButton, setShakeButton] = useState(false);

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
      onRegister({ email, password, name, phone, role: 'USER', approved: false, rejected: false });
      setSuccess('Solicitação enviada com sucesso! Seu acesso será avaliado por um mediador.');
      setIsRegistering(false);
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setName('');
      setPhone('');
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
                 <div className="w-20 h-20 filter drop-shadow-md">
                    <MFLogo className="w-full h-full" />
                 </div>
             </div>
            <h1 className="text-3xl font-extrabold text-gray-800 uppercase tracking-wide">Marcelo Far</h1>
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
                <input 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    className={getPasswordInputClass(password)}
                    placeholder="••••••••"
                    required
                />
                </div>
            )}

            {isRegistering && (
                <div className="group">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Confirmar Senha</label>
                  <input 
                    type="password" 
                    value={confirmPassword} 
                    onChange={(e) => setConfirmPassword(e.target.value)} 
                    className={getPasswordInputClass(confirmPassword)}
                    placeholder="••••••••"
                    required
                  />
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

  // App Logic State
  const [activeChecklistId, setActiveChecklistId] = useState<string>(CHECKLISTS[0].id);
  const [formData, setFormData] = useState<Record<string, ChecklistData>>({});
  const [images, setImages] = useState<Record<string, ChecklistImages>>({});
  const [signatures, setSignatures] = useState<Record<string, Record<string, string>>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [currentView, setCurrentView] = useState<'checklist' | 'summary' | 'report' | 'settings' | 'history' | 'view_history'>('checklist');
  const [ignoredChecklists, setIgnoredChecklists] = useState<Set<string>>(new Set());
  const errorBoxRef = useRef<HTMLDivElement>(null);
  
  // History State
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>(() => {
    try {
      const savedHistory = localStorage.getItem('APP_HISTORY');
      return savedHistory ? JSON.parse(savedHistory) : [];
    } catch {}
    return [];
  });
  const [viewHistoryItem, setViewHistoryItem] = useState<ReportHistoryItem | null>(null);
  const [historyFilterUser, setHistoryFilterUser] = useState<string>('all');

  // Master User Management State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserConfirmPass, setNewUserConfirmPass] = useState('');
  const [newUserRole, setNewUserRole] = useState<'MASTER' | 'USER'>('USER');
  const [internalShake, setInternalShake] = useState(false);
  const [internalPhoneError, setInternalPhoneError] = useState('');
  // Filters
  const [userFilterRole, setUserFilterRole] = useState<'ALL' | 'MASTER' | 'USER'>('ALL');
  const [userFilterStatus, setUserFilterStatus] = useState<'ALL' | 'ACTIVE' | 'PENDING' | 'BANNED'>('ALL');

  // Change Password State
  const [newPassInput, setNewPassInput] = useState('');
  const [confirmPassInput, setConfirmPassInput] = useState('');
  const [saveShake, setSaveShake] = useState(false);
  const [profilePhoneError, setProfilePhoneError] = useState('');


  // --- PERSISTENCE & INIT EFFECTS ---

  // MAIN INITIALIZATION - Load all data from Supabase on mount
  useEffect(() => {
    const initializeData = async () => {
      try {
        setIsLoadingData(true);
        
        // 1. Load Users from Supabase (fallback to localStorage)
        const dbUsers = await SupabaseService.fetchUsers();
        let mappedUsers: User[] = [];
        
        if (dbUsers.length > 0) {
          // Map preferred_theme from DB to preferredTheme in App
          mappedUsers = dbUsers.map(u => ({
            ...u,
            preferredTheme: u.preferred_theme as ThemeColor | undefined
          }));
          setUsers(mappedUsers);
          localStorage.setItem('APP_USERS', JSON.stringify(mappedUsers)); // Backup
        } else {
          // Fallback to localStorage
          const localUsers = localStorage.getItem('APP_USERS');
          if (localUsers) {
            mappedUsers = JSON.parse(localUsers);
            setUsers(mappedUsers);
          }
        }
        
        // 2. Load Config from Supabase (fallback to localStorage)
        const dbConfig = await SupabaseService.fetchConfig();
        if (dbConfig) {
          setConfig({
            pharmacyName: dbConfig.pharmacy_name,
            logo: dbConfig.logo
          });
          localStorage.setItem('APP_CONFIG', JSON.stringify({
            pharmacyName: dbConfig.pharmacy_name,
            logo: dbConfig.logo
          }));
        } else {
          // Fallback to localStorage
          const localConfig = localStorage.getItem('APP_CONFIG');
          if (localConfig) {
            setConfig(JSON.parse(localConfig));
          }
        }
        
        // 3. Load Reports from Supabase (fallback to localStorage)
        const dbReports = await SupabaseService.fetchReports();
        if (dbReports.length > 0) {
          const formattedReports = dbReports.map(r => ({
            id: r.id || r.created_at || Date.now().toString(),
            userEmail: r.user_email,
            userName: r.user_name,
            date: r.created_at || new Date().toISOString(),
            pharmacyName: r.pharmacy_name,
            score: r.score,
            formData: r.form_data,
            images: r.images,
            signatures: r.signatures,
            ignoredChecklists: r.ignored_checklists
          }));
          setReportHistory(formattedReports);
          localStorage.setItem('APP_HISTORY', JSON.stringify(formattedReports)); // Backup
        } else {
          // Fallback to localStorage
          const localHistory = localStorage.getItem('APP_HISTORY');
          if (localHistory) {
            setReportHistory(JSON.parse(localHistory));
          }
                    // Auto-migrate one-time when Supabase is empty and local has data
                    const alreadyMigrated = localStorage.getItem('APP_MIGRATED_DONE') === 'true';
                    const hasLocalData = !!localHistory || !!localStorage.getItem('APP_USERS') || !!localStorage.getItem('APP_DRAFTS') || !!localStorage.getItem('APP_CONFIG');
                    if (!alreadyMigrated && hasLocalData) {
                        try {
                            const mig = await SupabaseService.migrateLocalStorageToSupabase();
                            if (mig) {
                                localStorage.setItem('APP_MIGRATED_DONE', 'true');
                                // Refresh in-memory state from Supabase after migration
                                const refreshedReports = await SupabaseService.fetchReports();
                                if (refreshedReports.length > 0) {
                                    const formatted = refreshedReports.map(r => ({
                                        id: r.id || r.created_at || Date.now().toString(),
                                        userEmail: r.user_email,
                                        userName: r.user_name,
                                        date: r.created_at || new Date().toISOString(),
                                        pharmacyName: r.pharmacy_name,
                                        score: r.score,
                                        formData: r.form_data,
                                        images: r.images,
                                        signatures: r.signatures,
                                        ignoredChecklists: r.ignored_checklists
                                    }));
                                    setReportHistory(formatted);
                                    localStorage.setItem('APP_HISTORY', JSON.stringify(formatted));
                                }
                                const refreshedUsers = await SupabaseService.fetchUsers();
                                if (refreshedUsers.length > 0) {
                                    const mappedRefreshedUsers = refreshedUsers.map(u => ({
                                        ...u,
                                        preferredTheme: u.preferred_theme as ThemeColor | undefined
                                    }));
                                    setUsers(mappedRefreshedUsers);
                                    localStorage.setItem('APP_USERS', JSON.stringify(mappedRefreshedUsers));
                                }
                            }
                        } catch (e) {
                            console.error('Auto-migration failed:', e);
                        }
                    }
        }
        
        // 4. Restore session if exists
        const savedEmail = localStorage.getItem('APP_CURRENT_EMAIL');
        if (savedEmail) {
          // Use mappedUsers instead of dbUsers to ensure preferredTheme is loaded
          const user = mappedUsers.find(u => u.email === savedEmail) || 
                       JSON.parse(localStorage.getItem('APP_USERS') || '[]').find((u: User) => u.email === savedEmail);
          if (user) {
            setCurrentUser(user);
            
            // Load user's draft from Supabase
            const dbDraft = await SupabaseService.fetchDraft(savedEmail);
            if (dbDraft) {
              setFormData(dbDraft.form_data || {});
              setImages(dbDraft.images || {});
              setSignatures(dbDraft.signatures || {});
              setIgnoredChecklists(new Set(dbDraft.ignored_checklists || []));
            } else {
              // Fallback to localStorage draft
              const localDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
              const userDraft = localDrafts[savedEmail];
              if (userDraft) {
                setFormData(userDraft.formData || {});
                setImages(userDraft.images || {});
                setSignatures(userDraft.signatures || {});
                setIgnoredChecklists(new Set(userDraft.ignoredChecklists || []));
              }
            }
          }
        }
        
      } catch (error) {
        console.error('Error initializing data:', error);
        // On error, fallback to localStorage completely
        const localUsers = localStorage.getItem('APP_USERS');
        if (localUsers) setUsers(JSON.parse(localUsers));
        
        const localConfig = localStorage.getItem('APP_CONFIG');
        if (localConfig) setConfig(JSON.parse(localConfig));
        
        const localHistory = localStorage.getItem('APP_HISTORY');
        if (localHistory) setReportHistory(JSON.parse(localHistory));
      } finally {
        setIsLoadingData(false);
      }
    };
    
    initializeData();
  }, []);

  // Save Users to Supabase AND LocalStorage
  useEffect(() => {
    if (!isLoadingData && users.length > 0) {
      localStorage.setItem('APP_USERS', JSON.stringify(users));
      // Don't auto-save users to Supabase here to avoid conflicts
    }
  }, [users, isLoadingData]);

  // Save History to Supabase AND LocalStorage
  useEffect(() => {
    if (!isLoadingData && reportHistory.length > 0) {
      localStorage.setItem('APP_HISTORY', JSON.stringify(reportHistory));
      // Reports are saved individually when created, not in batch
    }
  }, [reportHistory, isLoadingData]);

  // Load Draft for Current User - only on initial login
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    if (currentUser && !draftLoaded) {
      const allDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
      const userDraft = allDrafts[currentUser.email];
      
      if (userDraft) {
        setFormData(userDraft.formData || {});
        setImages(userDraft.images || {});
        setSignatures(userDraft.signatures || {});
        setIgnoredChecklists(new Set(userDraft.ignoredChecklists || []));
      }
      
      setDraftLoaded(true);
    }
    if (!currentUser) {
      setDraftLoaded(false);
    }
  }, [currentUser]);

  // Sync currentUser with users array to get latest updates (like name/phone changes)
  useEffect(() => {
    if (currentUser) {
      const freshUser = users.find(u => u.email === currentUser.email);
      if (freshUser) {
        if (freshUser.name !== currentUser.name || 
            freshUser.phone !== currentUser.phone || 
            freshUser.photo !== currentUser.photo ||
            freshUser.preferredTheme !== currentUser.preferredTheme) {
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

  // Auto-Save Draft to Supabase AND LocalStorage
  useEffect(() => {
    if (currentUser && !isLoadingData) {
      // Save to LocalStorage (instant backup)
      const allDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
      allDrafts[currentUser.email] = {
        formData,
        images,
        signatures,
        ignoredChecklists: Array.from(ignoredChecklists)
      };
      localStorage.setItem('APP_DRAFTS', JSON.stringify(allDrafts));
      
      // Save to Supabase (async, with debounce)
      const timeoutId = setTimeout(async () => {
        await SupabaseService.saveDraft({
          user_email: currentUser.email,
          form_data: formData,
          images: images,
          signatures: signatures,
          ignored_checklists: Array.from(ignoredChecklists)
        });
      }, 1000); // Wait 1 second after last change
      
      return () => clearTimeout(timeoutId);
    }
  }, [formData, images, signatures, ignoredChecklists, currentUser, isLoadingData]);

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
  const activeChecklist = CHECKLISTS.find(c => c.id === activeChecklistId) || CHECKLISTS[0];
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
        // Clear persisted session on logout
        localStorage.removeItem('APP_CURRENT_EMAIL');
        setCurrentUser(null);
        setFormData({}); // Clear state from memory, relies on draft re-load
        setImages({});
        setSignatures({});
        setCurrentView('checklist');
    };
  
  const handleRegister = async (newUser: User) => {
    try {
      // Save to Supabase first
      const created = await SupabaseService.createUser(newUser);
      if (created) {
        // Add to local state
        setUsers(prev => [...prev, newUser]);
        // Backup to localStorage
        const updated = [...users, newUser];
        localStorage.setItem('APP_USERS', JSON.stringify(updated));
      } else {
        // Fallback to local only
        setUsers(prev => [...prev, newUser]);
        const updated = [...users, newUser];
        localStorage.setItem('APP_USERS', JSON.stringify(updated));
      }
    } catch (error) {
      // Fallback to local only on error
      setUsers(prev => [...prev, newUser]);
      const updated = [...users, newUser];
      localStorage.setItem('APP_USERS', JSON.stringify(updated));
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

  const handleUpdateUserProfile = async (field: keyof User, value: string) => {
    if (!currentUser) return;
    
    // Custom handling for phone in profile to limit 11 digits
    if (field === 'phone') {
        const val = value.replace(/\D/g, '');
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
  };  const handleSaveProfileAndSecurity = async () => {
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
          rejected: false
      };
      
      // Save to Supabase first
      const created = await SupabaseService.createUser(newUser);
      if (created) {
        setUsers(prev => [...prev, newUser]);
      } else {
        // Fallback to local only
        setUsers(prev => [...prev, newUser]);
      }
      
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPhone('');
      setNewUserPass('');
      setNewUserConfirmPass('');
      setInternalPhoneError('');
      setNewUserRole('USER');
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
    // IDs must match those in INFO_BASICA_SECTION (nome_coordenador, filial, gestor, data_aplicacao)
    const isGlobalField = ['nome_coordenador', 'filial', 'gestor', 'data_aplicacao'].includes(itemId);

    setFormData(prev => {
      const newData = { ...prev };
      
      // Update the current checklist data
      newData[activeChecklistId] = {
        ...(newData[activeChecklistId] || {}),
        [itemId]: value
      };

      // If this is a global field, update it in ALL other checklists as well
      if (isGlobalField) {
          CHECKLISTS.forEach(cl => {
              if (cl.id !== activeChecklistId) {
                  newData[cl.id] = {
                      ...(newData[cl.id] || {}),
                      [itemId]: value
                  };
              }
          });
      }

      return newData;
    });
  };

  const handleImageUpload = (sectionId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages(prev => {
            const currentListImages = prev[activeChecklistId] || {};
            const sectionImages = currentListImages[sectionId] || [];
            return {
                ...prev,
                [activeChecklistId]: {
                    ...currentListImages,
                    [sectionId]: [...sectionImages, reader.result as string]
                }
            };
        });
      };
      reader.readAsDataURL(file);
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
      setSignatures(prev => ({
          ...prev,
          [activeChecklistId]: {
              ...(prev[activeChecklistId] || {}),
              [role]: dataUrl
          }
      }));
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

  const handleResetChecklist = async () => {
    if (confirm("Tem certeza que deseja recomeçar todo o relatório? Todas as informações não salvas serão perdidas.")) {
        if (currentUser) {
          // Delete from localStorage
          const allDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
          delete allDrafts[currentUser.email];
          localStorage.setItem('APP_DRAFTS', JSON.stringify(allDrafts));
          // Delete from Supabase
          await SupabaseService.deleteDraft(currentUser.email);
        }
        window.location.reload();
    }
  };

  const handleFinalizeAndSave = async () => {
      if (!currentUser) return;
      
      // Strict Validation: Must have at least one active checklist, AND all active checklists must be complete
      const activeChecklistIds = CHECKLISTS.filter(cl => !ignoredChecklists.has(cl.id)).map(cl => cl.id);
      
      if (activeChecklistIds.length === 0) {
          alert("Erro: Você deve preencher pelo menos um checklist para finalizar.");
          return;
      }
      
      const incompleteChecklists = activeChecklistIds.filter(id => !isChecklistComplete(id));
      
      if (incompleteChecklists.length > 0) {
          const names = incompleteChecklists.map(id => CHECKLISTS.find(c => c.id === id)?.title).join('\n- ');
          alert(`Erro: Os seguintes checklists ativos estão incompletos:\n- ${names}\n\nPor favor, complete-os ou marque como 'Não se Aplica' para continuar.`);
          return;
      }

      const score = calculateGlobalScore();
      
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
      const alreadyExists = await SupabaseService.reportExists(candidateReport as any);
      if (alreadyExists) {
          alert('Este relatório já foi registrado anteriormente. Não será duplicado.');
          // Apenas levar para a visualização do mais recente igual
          setCurrentView('history');
          return;
      }

      // Save to Supabase first
      const dbReport = await SupabaseService.createReport(candidateReport as any);
      
      const newReport: ReportHistoryItem = {
          id: dbReport?.id || Date.now().toString(),
          userEmail: currentUser.email,
          userName: currentUser.name,
          date: dbReport?.created_at || new Date().toISOString(),
          pharmacyName: config.pharmacyName,
          score: score,
          formData: { ...formData },
          images: { ...images },
          signatures: { ...signatures },
          ignoredChecklists: Array.from(ignoredChecklists)
      };

      setReportHistory(prev => [newReport, ...prev]);
      
      // Clear Draft from state
      setFormData({});
      setImages({});
      setSignatures({});
      setIgnoredChecklists(new Set());
      
      // Clear from localStorage
      const allDrafts = JSON.parse(localStorage.getItem('APP_DRAFTS') || '{}');
      delete allDrafts[currentUser.email];
      localStorage.setItem('APP_DRAFTS', JSON.stringify(allDrafts));
      
      // Clear from Supabase
      await SupabaseService.deleteDraft(currentUser.email);

      alert("Relatório salvo e arquivado com sucesso!");
      
      // Redirect to View History (Report View)
      setViewHistoryItem(newReport);
      setCurrentView('view_history');
  };

  const handleViewHistoryItem = (item: ReportHistoryItem) => {
      setViewHistoryItem(item);
      setCurrentView('view_history');
  };

  const handleDownloadPDF = () => {
      document.title = `Relatorio_Avaliacao_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}`;
      window.print();
      // Reset title after print dialog closes (approximate)
      setTimeout(() => document.title = 'Drogaria Cidade - Checklists', 1000);
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

     const checklist = CHECKLISTS.find(c => c.id === checklistId);
     if (!checklist) return false;

     for (const section of checklist.sections) {
        for (const item of section.items) {
            const val = getInputValue(item.id, checklistId);
            if (item.required && (val === '' || val === null || val === undefined)) return false;
        }
     }
     const currentSigs = signatures[checklistId] || {};
     if (!currentSigs['gestor']) return false; 
     
     return true;
  };

  const getChecklistStats = (checklistId: string) => {
      const checklist = CHECKLISTS.find(c => c.id === checklistId);
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
      
      CHECKLISTS.forEach(cl => {
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

  const handleVerify = () => {
    setShowErrors(true);
    
    const stats = getChecklistStats(activeChecklistId);
    const hasSigMissing = !signatures[activeChecklistId]?.['gestor'];

    if (stats.missingItems.length > 0 || hasSigMissing || stats.unansweredItems.length > 0) {
        // Scroll to error box at the bottom
        setTimeout(() => {
             errorBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      window.scrollTo(0,0);
      setIsSidebarOpen(false);
  };
  
  const handleNextChecklist = () => {
      // Validate Current Checklist first
      const stats = getChecklistStats(activeChecklistId);
      const hasSigMissing = !signatures[activeChecklistId]?.['gestor'];

      if (stats.missingItems.length > 0 || hasSigMissing) {
          setShowErrors(true);
           setTimeout(() => {
             errorBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        return; // Block navigation
      }

      const idx = CHECKLISTS.findIndex(c => c.id === activeChecklistId);
      if(idx < CHECKLISTS.length - 1) {
            setActiveChecklistId(CHECKLISTS[idx+1].id);
            window.scrollTo(0,0);
            setShowErrors(false);
      } else {
            handleViewChange('summary');
      }
  };

  // --- FILTERED HISTORY ---
  const getFilteredHistory = () => {
      if (currentUser?.role === 'MASTER') {
          if (historyFilterUser === 'all') return reportHistory;
          return reportHistory.filter(r => r.userEmail === historyFilterUser);
      }
      // USER role sees only master's reports
      return reportHistory.filter(r => r.userEmail === 'asconavietagestor@gmail.com');
  };

  // --- RENDER ---

  // Loading Screen
  if (isLoadingData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6">
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
                <LoginScreen onLogin={handleLogin} users={users} onRegister={handleRegister} />
            </>
        );
    }

  // Determine if we are in "Read Only" mode (History View)
  const isReadOnly = currentView === 'view_history' || currentUser?.role === 'USER';
  const displayConfig = isReadOnly && viewHistoryItem ? { ...config, pharmacyName: viewHistoryItem.pharmacyName } : config;
  
  // Calculate current checklist specific stats for render
  const currentChecklistStats = getChecklistStats(activeChecklistId);
  const currentMissingItems = currentChecklistStats.missingItems;
  const currentUnansweredItems = currentChecklistStats.unansweredItems;
  const currentSigMissing = !signatures[activeChecklistId]?.['gestor'];
  
  // Get Basic Info from First Active Checklist
  // We assume all checklists have synced info, so we take from the first one in the list.
  const basicInfoSourceChecklist = CHECKLISTS[0].id; // Always defaults to 'gerencial', or first one. 
  // If 'gerencial' is ignored, we still have the data because syncing happens on input.
  // Actually, for display in report, we should just use the first checklist in the definitions, as they are synced.

  return (
    <div className="min-h-screen bg-gray-50 flex font-sans text-gray-800">
      {/* Sidebar - Elevated Design */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:inset-auto no-print flex flex-col border-r border-gray-100`}
      >
        <div className={`h-28 flex items-center justify-center p-4 ${currentTheme.bgGradient} relative overflow-hidden shadow-md group`}>
          <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
          <div className="relative z-10 w-full flex justify-center">
             <Logo config={displayConfig} />
          </div>
          {/* Quick Config Button */}
          <button 
            onClick={() => handleViewChange('settings')}
            className="absolute top-2 right-2 p-1.5 text-white/70 hover:text-white hover:bg-white/20 rounded-full transition-all"
            title="Configurar Marca"
          >
            <Settings size={16} />
          </button>
        </div>
        
        <div className="px-6 py-6 border-b border-gray-100 bg-white relative">
           <div className="flex items-center gap-4">
             <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${currentTheme.bgGradient} shadow-md border-2 border-white overflow-hidden`}>
               {currentUser.photo ? (
                 <img src={currentUser.photo} alt="Profile" className="w-full h-full object-cover" />
               ) : (
                 currentUser.name.charAt(0)
               )}
             </div>
             <div className="flex-1 min-w-0">
               <p className="text-sm font-bold text-gray-900 truncate">{currentUser.name}</p>
               <p className="text-xs text-gray-500 truncate uppercase tracking-wider font-semibold">{currentUser.role === 'MASTER' ? 'Administrador' : 'Usuário'}</p>
             </div>
           </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-2 custom-scrollbar">
            <div className="px-3 mb-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Checklists (Rascunho)</div>
            {CHECKLISTS.map(checklist => {
                 const complete = isChecklistComplete(checklist.id);
                 const ignored = ignoredChecklists.has(checklist.id);
                 const isActive = activeChecklistId === checklist.id && currentView === 'checklist';
                 return (
                  <button
                      key={checklist.id}
                      onClick={() => { setActiveChecklistId(checklist.id); handleViewChange('checklist'); }}
                      className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 relative overflow-hidden ${
                        isActive
                          ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm` 
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      {isActive && <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${currentTheme.bg}`}></div>}
                      <Clipboard className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${isActive ? '' : 'text-gray-400'}`} />
                      <div className="flex-1 text-left truncate">
                        <span className={ignored ? 'line-through opacity-50' : ''}>{checklist.title}</span>
                      </div>
                      {complete && !ignored && <CheckCircle size={18} className="text-green-500 ml-2 drop-shadow-sm" />}
                    </button>
                );
              })}

            <div className="px-3 mt-8 mb-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Gerenciamento</div>
            
            {currentUser?.role === 'MASTER' && (
            <button
                onClick={() => handleViewChange('summary')}
                className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                    currentView === 'summary' 
                    ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm` 
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
            >
                <LayoutDashboard className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'summary' ? '' : 'text-gray-400'}`} />
                Visão Geral / Finalizar
            </button>
            )}

            <button
                onClick={() => handleViewChange('history')}
                className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                    currentView === 'history' 
                    ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm` 
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
            >
                <History className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'history' ? '' : 'text-gray-400'}`} />
                Histórico de Relatórios
            </button>

            <button
                onClick={() => handleViewChange('settings')}
                className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                    currentView === 'settings' 
                    ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm` 
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
            >
                <Settings className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'settings' ? '' : 'text-gray-400'}`} />
                Configurações
            </button>
        </nav>

        <div className="p-4 border-t border-gray-100">
             <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-red-600 hover:bg-red-50 p-3 rounded-xl transition-colors">
               <LogOut size={18} />
               Sair do Sistema
             </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50/50 relative">
        {/* Background Mesh Gradient */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-gray-200 via-transparent to-transparent"></div>

                {/* Mobile Header */}
                <header className={`${currentTheme.bgGradient} shadow-md lg:hidden h-18 flex items-center px-4 justify-between no-print z-20`}>
                        <Logo config={displayConfig} />
                        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-white p-2 rounded-lg hover:bg-white/10">
                                {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
                        </button>
                </header>

                {/* Mobile Actions Bar: Title + Recomeçar */}
                <div className="lg:hidden no-print bg-white/90 backdrop-blur-sm border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-18 z-20">
                        <h1 className="text-base font-extrabold text-gray-800 truncate tracking-tight">
                            {currentView === 'report' || currentView === 'view_history' ? 'Relatório Consolidado' : 
                             currentView === 'summary' ? 'Visão Geral da Avaliação' : 
                             currentView === 'settings' ? 'Configurações do Sistema' :
                             currentView === 'history' ? 'Histórico de Relatórios' :
                             activeChecklist.title}
                        </h1>
                        {currentView === 'checklist' && currentUser?.role === 'MASTER' && (
                            <button
                                onClick={handleResetChecklist}
                                className="flex items-center gap-2 text-gray-400 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors text-xs font-bold"
                                title="Limpar todos os dados do relatório atual"
                            >
                                <RotateCcw size={16} />
                                <span>Recomeçar</span>
                            </button>
                        )}
                </div>

        {/* Desktop Header */}
        <header className="hidden lg:flex items-center justify-between h-20 bg-white/80 backdrop-blur-md border-b border-gray-200 px-10 shadow-sm no-print sticky top-0 z-30">
            <h1 className="text-2xl font-extrabold text-gray-800 truncate tracking-tight">
              {currentView === 'report' || currentView === 'view_history' ? 'Relatório Consolidado' : 
               currentView === 'summary' ? 'Visão Geral da Avaliação' : 
               currentView === 'settings' ? 'Configurações do Sistema' :
               currentView === 'history' ? 'Histórico de Relatórios' :
               activeChecklist.title}
            </h1>
            
            <div className="flex items-center gap-4">
                {currentView === 'checklist' && currentUser?.role === 'MASTER' && (
                     <button
                        onClick={handleResetChecklist}
                        className="flex items-center gap-2 text-gray-400 hover:text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors text-sm font-bold"
                        title="Limpar todos os dados do relatório atual"
                     >
                         <RotateCcw size={16} />
                         Recomeçar
                     </button>
                )}

                {(currentView === 'report' || currentView === 'view_history') && (
                <button 
                    onClick={handleDownloadPDF}
                    className="flex items-center gap-2 bg-gray-800 text-white px-6 py-2.5 rounded-lg hover:bg-gray-900 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-sm font-bold tracking-wide"
                >
                    <Printer size={18} />
                    <span>IMPRIMIR / PDF</span>
                </button>
                )}
            </div>
        </header>

        {/* Main Body */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-10 z-10 scroll-smooth">
            
            {/* --- SETTINGS VIEW --- */}
            {currentView === 'settings' && (
                <div className="max-w-4xl mx-auto space-y-8 animate-fade-in relative pb-24">
                    
                    {/* Appearance Settings */}
                    <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
                        <h2 className="text-xl font-bold text-gray-800 mb-8 flex items-center gap-3 border-b border-gray-100 pb-4">
                           <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                <Palette size={24} className={currentTheme.text} />
                           </div>
                           Personalização e Aparência
                        </h2>
                        
                        <div className="space-y-10">
                            {currentUser.role === 'MASTER' && (
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Nome da Farmácia</label>
                                    <input 
                                        type="text" 
                                        value={config.pharmacyName}
                                        onChange={(e) => setConfig({ ...config, pharmacyName: e.target.value })}
                                        className={`w-full bg-white border border-gray-300 rounded-xl p-3 text-gray-900 focus:ring-2 ${currentTheme.ring} outline-none shadow-inner-light transition-all`}
                                    />
                                    <p className="text-xs text-gray-500 mt-2 font-medium">Exibido no cabeçalho e relatórios.</p>
                                </div>
                            )}

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

                            {currentUser.role === 'MASTER' && (
                                <div className="col-span-1 md:col-span-2">
                                    <label className="block text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Logo da Empresa</label>
                                    <div className="flex items-center gap-8 bg-gray-50 p-6 rounded-2xl border border-gray-200">
                                        <div className="h-28 w-44 bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center overflow-hidden relative">
                                            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/graphy.png')] opacity-10"></div>
                                            {config.logo ? (
                                                <img src={config.logo} alt="Preview" className="h-full w-full object-contain p-2 relative z-10" />
                                            ) : (
                                                <ImageIcon className="text-gray-300 relative z-10" size={40} />
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-3">
                                            <label className={`cursor-pointer inline-flex items-center px-5 py-2.5 border border-gray-300 shadow-sm text-sm font-bold rounded-lg text-gray-700 bg-white hover:bg-gray-50 hover:shadow-md transition-all`}>
                                                <Upload size={18} className="mr-2" />
                                                Carregar Imagem
                                                <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                                            </label>
                                            {config.logo && (
                                                <button 
                                                    onClick={() => setConfig({ ...config, logo: null })}
                                                    className="text-sm text-red-600 hover:text-red-800 font-semibold"
                                                >
                                                    Remover Logo
                                                </button>
                                            )}
                                            <p className="text-xs text-gray-400">Recomendado: PNG Transparente</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

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
                                
                                <div className="border-t border-gray-200 pt-6 mt-4">
                                     <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4 flex items-center gap-2">
                                        <Lock size={16} className="text-gray-400" /> Alterar Senha (Opcional)
                                     </h3>
                                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Nova Senha</label>
                                            <input 
                                                type="password" 
                                                value={newPassInput}
                                                onChange={(e) => setNewPassInput(e.target.value)}
                                                placeholder="Preencher apenas para alterar"
                                                className={`w-full rounded-lg p-3 outline-none shadow-inner-light transition-all ${
                                                    newPassInput && confirmPassInput && newPassInput !== confirmPassInput 
                                                    ? 'bg-red-50 border border-red-500 text-red-900 focus:ring-2 focus:ring-red-200' 
                                                    : newPassInput && confirmPassInput && newPassInput === confirmPassInput
                                                    ? 'bg-green-50 border border-green-500 text-gray-900 focus:ring-2 focus:ring-green-200'
                                                    : `bg-white border border-gray-300 text-gray-900 focus:ring-2 ${currentTheme.ring}`
                                                }`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Confirmar Nova Senha</label>
                                            <input 
                                                type="password" 
                                                value={confirmPassInput}
                                                onChange={(e) => setConfirmPassInput(e.target.value)}
                                                placeholder="Confirme a nova senha"
                                                className={`w-full rounded-lg p-3 outline-none shadow-inner-light transition-all ${
                                                    newPassInput && confirmPassInput && newPassInput !== confirmPassInput 
                                                    ? 'bg-red-50 border border-red-500 text-red-900 focus:ring-2 focus:ring-red-200' 
                                                    : newPassInput && confirmPassInput && newPassInput === confirmPassInput
                                                    ? 'bg-green-50 border border-green-500 text-gray-900 focus:ring-2 focus:ring-green-200'
                                                    : `bg-white border border-gray-300 text-gray-900 focus:ring-2 ${currentTheme.ring}`
                                                }`}
                                            />
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
                    {currentUser.role === 'MASTER' && (
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
                                    <input 
                                        type="password" 
                                        placeholder="Senha Provisória" 
                                        value={newUserPass}
                                        onChange={(e) => setNewUserPass(e.target.value)}
                                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none" 
                                    />
                                    {/* Added Confirmation Input */}
                                    <input 
                                        type="password" 
                                        placeholder="Confirmar Senha" 
                                        value={newUserConfirmPass}
                                        onChange={(e) => setNewUserConfirmPass(e.target.value)}
                                        className={`w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none ${newUserPass && newUserConfirmPass && newUserPass !== newUserConfirmPass ? 'border-red-500 bg-red-50' : ''}`} 
                                    />
                                    <select 
                                        value={newUserRole}
                                        onChange={(e) => setNewUserRole(e.target.value as 'MASTER' | 'USER')}
                                        className="w-full border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none bg-white lg:col-span-3"
                                    >
                                        <option value="USER">Criar Perfil: Usuário Comum</option>
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
                    
                    {/* Prominent Pending Users Alert at Bottom (Compact Version with Inline Actions) */}
                    {currentUser.role === 'MASTER' && pendingUsersCount > 0 && (
                        <div className="mt-8 bg-red-600 rounded-2xl p-6 text-white shadow-2xl shadow-red-200 relative overflow-hidden group transform hover:-translate-y-1 transition-all max-w-2xl mx-auto">
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
                                         <AlertCircle size={14}/> Obrigatório
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
                                         <AlertTriangle size={14}/> Atenção (Impacta Nota)
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
                                        {[1,2,3,4,5].map(star => (
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
                                return <p key={item.id} className="text-sm text-gray-500 italic mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100 flex items-start gap-2"><div className="mt-0.5 min-w-4"><AlertCircle size={14}/></div>{item.text}</p>;
                             }

                             return (
                               <div key={item.id} className="mb-4">
                                   <div className="flex justify-between mb-1.5">
                                       <label className="block text-sm font-bold text-gray-700">{item.text} {item.required && <span className="text-red-500">*</span>}</label>
                                       {item.helpText && <span className="text-xs text-gray-400 cursor-help" title={item.helpText}><AlertCircle size={12} /></span>}
                                   </div>
                                   
                                   {item.type === InputType.TEXT && (
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
                           <SignaturePad label="Assinatura do Gestor" onEnd={(data) => handleSignature('gestor', data)} />
                           <SignaturePad label="Assinatura Coordenador / Aplicador" onEnd={(data) => handleSignature('coordenador', data)} />
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
                               {CHECKLISTS.findIndex(c => c.id === activeChecklistId) < CHECKLISTS.length - 1 ? (
                                   <>Próximo Checklist <ChevronRight size={20}/></>
                               ) : (
                                   <>Revisar e Finalizar <CheckCircle size={20}/></>
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
                    {CHECKLISTS.map(cl => {
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
                                                onClick={() => {setActiveChecklistId(cl.id); handleViewChange('checklist');}}
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
                                                <div style={{width: `${percentPassed}%`}} className="h-full bg-green-500 transition-all duration-1000 ease-out"></div>
                                                <div style={{width: `${percentFailed}%`}} className="h-full bg-red-500 transition-all duration-1000 ease-out"></div>
                                            </div>
                                        </div>
                                        
                                        {/* Show missing items if any */}
                                        {stats.missingItems.length > 0 && (
                                            <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="p-1.5 bg-yellow-200 rounded-full text-yellow-700"><AlertCircle size={16}/></div>
                                                    <span className="font-bold text-yellow-800 text-sm uppercase">Pendências (Obrigatório)</span>
                                                </div>
                                                <ul className="space-y-2 mt-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                                    {stats.missingItems.map((miss, i) => (
                                                        <li key={i} className="text-xs text-yellow-700 bg-white/50 p-2 rounded border border-yellow-100 flex items-start gap-2">
                                                            <div className="mt-0.5 min-w-3"><AlertTriangle size={12}/></div>
                                                            <span><strong className="block text-yellow-800 opacity-70 mb-0.5">{miss.section}</strong> {miss.text}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="p-1.5 bg-green-200 rounded-full text-green-700"><Check size={16}/></div>
                                                    <span className="font-bold text-green-800 text-sm uppercase">Itens Conformes</span>
                                                </div>
                                                <div className="text-3xl font-black text-green-700">{stats.passed} <span className="text-sm font-medium text-green-600 opacity-70">/ {stats.total}</span></div>
                                            </div>
                                            <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="p-1.5 bg-red-200 rounded-full text-red-700"><AlertTriangle size={16}/></div>
                                                    <span className="font-bold text-red-800 text-sm uppercase">Itens Não Conformes</span>
                                                </div>
                                                {stats.failedItems.length > 0 ? (
                                                    <div className="mt-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                                        <ul className="space-y-2">
                                                            {stats.failedItems.map((fail, i) => (
                                                                <li key={i} className="text-xs text-red-700 bg-white/50 p-2 rounded border border-red-100 flex items-start gap-2">
                                                                    <div className="mt-0.5 min-w-3"><X size={12}/></div>
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
                                                onClick={() => {setActiveChecklistId(cl.id); handleViewChange('checklist');}}
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
                                                 <div style={{width: `${percentPassed}%`}} className={`h-full bg-green-500 transition-all duration-1000 ease-out`}></div>
                                                 <div style={{width: `${percentFailed}%`}} className={`h-full bg-red-500 transition-all duration-1000 ease-out`}></div>
                                             </div>
                                        </div>

                                        {/* Detailed Breakdown Grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Passed Items */}
                                            <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="p-1.5 bg-green-200 rounded-full text-green-700"><Check size={16}/></div>
                                                    <span className="font-bold text-green-800 text-sm uppercase">Itens Conformes</span>
                                                </div>
                                                <div className="text-3xl font-black text-green-700">{stats.passed} <span className="text-sm font-medium text-green-600 opacity-70">/ {stats.total}</span></div>
                                            </div>

                                            {/* Failed Items List */}
                                            <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div className="p-1.5 bg-red-200 rounded-full text-red-700"><AlertTriangle size={16}/></div>
                                                    <span className="font-bold text-red-800 text-sm uppercase">Itens Não Conformes</span>
                                                </div>
                                                {stats.failedItems.length > 0 ? (
                                                    <div className="mt-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                                                        <ul className="space-y-2">
                                                            {stats.failedItems.map((fail, i) => (
                                                                <li key={i} className="text-xs text-red-700 bg-white/50 p-2 rounded border border-red-100 flex items-start gap-2">
                                                                    <div className="mt-0.5 min-w-3"><X size={12}/></div>
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
                                                 {[1,2,3,4,5].map(star => (
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
                             <button onClick={handleFinalizeAndSave} className={`px-8 py-4 rounded-xl text-white font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-200 flex items-center gap-2`}>
                                 <Save size={20} />
                                 FINALIZAR E SALVAR RELATÓRIO
                             </button>
                         </div>
                    </div>
                </div>
            )}

            {/* --- REPORT / HISTORY VIEW (READ ONLY) --- */}
            {(currentView === 'report' || currentView === 'view_history') && (
                <div className="max-w-5xl mx-auto bg-white p-10 shadow-2xl rounded-3xl min-h-screen print:shadow-none print:px-8 print:py-6 print:w-full">
                    <LogoPrint config={displayConfig} theme={currentTheme} />
                    
                    {/* Basic Info Block (Extracted Top) */}
                    <div className="mb-10 pb-8">
                         <h3 className={`text-xl font-black uppercase tracking-tight mb-6 pb-2 border-b-2 ${currentTheme.border} ${currentTheme.text}`}>Informações Básicas</h3>
                         <div className="grid grid-cols-2 gap-8">
                             <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Nome do Coordenador / Aplicador</p>
                                 <p className="text-lg font-bold text-gray-800">{getInputValue('nome_coordenador', basicInfoSourceChecklist) || '-'}</p>
                             </div>
                             <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Filial</p>
                                 <p className="text-lg font-bold text-gray-800">{getInputValue('filial', basicInfoSourceChecklist) || '-'}</p>
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

                    <div className="grid grid-cols-2 gap-8 mb-10 border-b-2 border-gray-100 pb-8">
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
                            <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-2xl border border-gray-200 mb-10 text-center">
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

                    <div className="space-y-12">
                         {CHECKLISTS.map(cl => {
                             const isIgnored = viewHistoryItem ? viewHistoryItem.ignoredChecklists.includes(cl.id) : ignoredChecklists.has(cl.id);
                             if (isIgnored) return null;
                             
                             return (
                                 <div key={cl.id} className="break-inside-avoid">
                                     <h3 className={`text-xl font-black uppercase tracking-tight mb-6 pb-2 border-b-2 ${currentTheme.border} ${currentTheme.text}`}>{cl.title}</h3>
                                     <div className="space-y-8">
                                         {cl.sections.map(sec => {
                                            // SKIP INFO BASICA IN INDIVIDUAL SECTIONS (Already shown at top)
                                            if (sec.id === 'info_basica') return null;

                                            return (
                                             <div key={sec.id} className="mb-6">
                                                 <h4 className="font-bold text-gray-800 mb-4 uppercase text-sm tracking-wide bg-gray-100 p-2 pl-4 rounded-lg">{sec.title}</h4>
                                                 <div className="pl-4 space-y-3">
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
                                                     <div className="mt-4 grid grid-cols-4 gap-4">
                                                         {(getDataSource(cl.id).imgs[sec.id] || []).map((img, idx) => (
                                                             <div key={idx} className="h-32 rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                                                                 <img src={img} className="w-full h-full object-cover" />
                                                             </div>
                                                         ))}
                                                     </div>
                                                 )}
                                             </div>
                                         )})}
                                     </div>
                                     {/* Signatures in Report */}
                                     <div className="mt-8 flex justify-end gap-8">
                                         {getDataSource(cl.id).sigs['gestor'] && (
                                             <div className="text-center">
                                                 <img src={getDataSource(cl.id).sigs['gestor']} className="h-20 mb-2 border-b border-gray-300" />
                                                 <p className="text-xs font-bold text-gray-500 uppercase">Assinatura Gestor</p>
                                             </div>
                                         )}
                                          {getDataSource(cl.id).sigs['coordenador'] && (
                                             <div className="text-center">
                                                 <img src={getDataSource(cl.id).sigs['coordenador']} className="h-20 mb-2 border-b border-gray-300" />
                                                 <p className="text-xs font-bold text-gray-500 uppercase">Assinatura Coordenador</p>
                                             </div>
                                         )}
                                     </div>
                                 </div>
                             );
                         })}
                    </div>

                    <div className="mt-12 flex justify-center no-print">
                        <button onClick={handleDownloadPDF} className="flex items-center gap-2 bg-gray-800 text-white px-8 py-3 rounded-xl hover:bg-gray-900 transition-all shadow-lg font-bold">
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
                         <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                           <div className={`p-2 rounded-lg ${currentTheme.lightBg}`}>
                                <History size={24} className={currentTheme.text} />
                           </div>
                           Histórico de Avaliações
                        </h2>
                        
                        {/* Filters for Master */}
                        {currentUser.role === 'MASTER' && (
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
                                        <th className="px-6 py-4">Farmácia</th>
                                        <th className="px-6 py-4">Responsável</th>
                                        <th className="px-6 py-4">Nota</th>
                                        <th className="px-6 py-4 text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {getFilteredHistory().length === 0 ? (
                                        <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">Nenhum relatório encontrado.</td></tr>
                                    ) : (
                                        getFilteredHistory().map(report => (
                                            <tr key={report.id} className="hover:bg-gray-50 transition-colors group">
                                                <td className="px-6 py-4 font-medium text-gray-700">
                                                    {new Date(report.date).toLocaleDateString('pt-BR')} <span className="text-gray-400 text-xs ml-1">{new Date(report.date).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-gray-800">{report.pharmacyName}</td>
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
                                                    {currentUser.role === 'MASTER' && (
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
                 </div>
            )}

        </main>
      </div>
    </div>
  );
};

export default App;