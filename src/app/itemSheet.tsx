import { createContext, useContext, useState, type ReactNode } from 'react';
import { ItemEditor } from '../features/items/ItemEditor';

const Ctx = createContext<(id: string) => void>(() => {});

/** One item editor for the whole app: any row can open it. */
export function ItemSheetProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  return (
    <Ctx.Provider value={setId}>
      {children}
      <ItemEditor id={id} onClose={() => setId(null)} />
    </Ctx.Provider>
  );
}

export const useOpenItem = () => useContext(Ctx);
