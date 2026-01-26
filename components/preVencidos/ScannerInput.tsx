
import React, { useState, useRef, useEffect } from 'react';
import { ScanLine } from 'lucide-react';

interface ScannerInputProps {
  onScan: (code: string) => void;
  placeholder?: string;
}

const ScannerInput: React.FC<ScannerInputProps> = ({ onScan, placeholder }) => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Keep focus on the input for scanners
    const handleGlobalClick = () => {
      inputRef.current?.focus();
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      onScan(inputValue.trim());
      setInputValue('');
    }
  };

  return (
    <div className="relative w-full">
      <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400">
        <ScanLine size={32} />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Bipar código de barras ou reduzido..."}
        className="w-full pl-20 pr-6 py-10 bg-white border-2 border-slate-200 rounded-2xl text-2xl font-mono focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all placeholder:text-slate-300"
        autoFocus
      />
      <div className="mt-4 text-center text-slate-400 text-sm">
        Pressione Enter após digitar se não estiver usando scanner.
      </div>
    </div>
  );
};

export default ScannerInput;
