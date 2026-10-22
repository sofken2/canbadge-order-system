// ブラウザの保存場所（localStorage・sessionStorage）。サイトのデータを禁止したブラウザでは、
// window.localStorage を読むだけで例外になる。覚えておく機能は、なくても注文は困らないので、
// そのときは何も覚えない入れ物を返して、画面を止めない

type SimpleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const nothing: SimpleStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function open(kind: "localStorage" | "sessionStorage"): SimpleStorage {
  try {
    return window[kind];
  } catch {
    return nothing;
  }
}

/** localStorage（使えなければ、何も覚えない入れ物） */
export const localStore = () => open("localStorage");
/** sessionStorage（使えなければ、何も覚えない入れ物） */
export const sessionStore = () => open("sessionStorage");
