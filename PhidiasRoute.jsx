/**
 * PhidiasRoute.jsx
 *
 * Portal-side route wrapper for the Phidias Web Component.
 *
 * Responsibilities:
 *  1. Dynamically load the phidias-wc.js script once (idempotent)
 *  2. Render the <phidias-app> custom element, filling the available space
 *
 * Usage in route.jsx:
 *   const PhidiasRoute = lazy(() => import('./modules/phidias/PhidiasRoute'));
 *   <Route path="phidias/*" element={<PhidiasRoute />} />
 */

import { useEffect, useRef, useState } from 'react';

// Path where the WC bundle is served.
// In dev: place dist/* in client/public/phidias/ and run `npm run dev`.
// In CI:  the Docker multi-stage build copies the artifact there automatically.
const WC_SCRIPT_URL = '/phidias/phidias-wc.mjs';
const WC_STYLE_URL = '/phidias/style.css';

/** Singleton promise — ensures assets are fetched exactly once. */
let _loadPromise = null;

function loadPhidiasAssets() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = new Promise((resolve, reject) => {
        // Already registered (e.g. HMR re-mount)
        if (customElements.get('phidias-app')) {
            resolve();
            return;
        }

        // Load Styles
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = WC_STYLE_URL;
        document.head.appendChild(link);

        // Load Script
        const script = document.createElement('script');
        script.type = 'module';
        script.src = WC_SCRIPT_URL;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${WC_SCRIPT_URL}`));
        document.head.appendChild(script);
    });
    return _loadPromise;
}

export default function PhidiasRoute(props) {
    const [ready, setReady] = useState(() => !!customElements.get('phidias-app'));
    const [error, setError] = useState(null);
    const containerRef = useRef(null);

    useEffect(() => {
        if (ready) return;
        loadPhidiasAssets()
            .then(() => setReady(true))
            .catch((err) => setError(err.message));
    }, [ready]);

    if (error) {
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 'calc(100vh - 80px)',
                    background: '#1a1a2e',
                    color: '#ef4444',
                    gap: 8,
                    fontSize: 14,
                }}
            >
                <span>⚠️ Could not load Phidias</span>
                <span style={{ color: '#64748b', fontSize: 12 }}>{error}</span>
            </div>
        );
    }

    if (!ready) {
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 'calc(100vh - 80px)',
                    background: '#1a1a2e',
                    color: '#94a3b8',
                    fontSize: 13,
                }}
            >
                Loading Phidias…
            </div>
        );
    }

    // phidias-app is a custom element — JSX can't infer its type,
    // but it works fine at runtime after the WC script is loaded.
    return (
        <div ref={containerRef} style={{ width: '100%', height: 'calc(100vh - 80px)' }}>
            {/* eslint-disable-next-line react/no-unknown-property */}
            <phidias-app
                base-path="/phidias"
                api-base-url={props['api-base-url']}
            />
        </div>
    );
}
