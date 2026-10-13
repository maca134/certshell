import { useEffect, useState } from "react";
import { SESSION_EXPIRED } from "./api";
import { Button } from "./components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./components/ui/dialog";

export function SessionExpired() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const show = () => setOpen(true);
        addEventListener(SESSION_EXPIRED, show);
        return () => removeEventListener(SESSION_EXPIRED, show);
    }, []);
    const signIn = () => {
        location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    };
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Session ended</DialogTitle>
                    <DialogDescription>
                        Sign in again to keep using CertShell. Open terminals
                        keep running until you close them.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Later</Button>
                    </DialogClose>
                    <Button onClick={signIn}>Sign in</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
