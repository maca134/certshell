import "./index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionExpired } from "./SessionExpired";

const root = document.getElementById("root");
if (root)
    createRoot(root).render(
        <>
            <App />
            <SessionExpired />
        </>,
    );
