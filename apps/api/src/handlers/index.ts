import type { Handlers } from "../register";
import { monitorHandlers } from "./monitor";
import { publicHandlers } from "./public";
import { staffHandlers } from "./staff";

/** 全エンドポイントのハンドラー。契約（endpoints）に 1 つ足りなくても、ここで型のエラーになる */
export const handlers: Handlers = { ...publicHandlers, ...staffHandlers, ...monitorHandlers };
