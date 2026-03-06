'use client'

import React, { createContext, useContext, useEffect, useRef } from 'react'
import type { AppConfig } from './types'
import { usePhidiasStore } from '../store/phidias-store'

const ConfigContext = createContext<AppConfig | null>(null)

export function ConfigProvider({
    config,
    children,
}: {
    config: AppConfig
    children: React.ReactNode
}) {
    const initialized = useRef(false)
    if (!initialized.current) {
        usePhidiasStore.setState({ apiBaseUrl: config.apiBaseUrl })
        initialized.current = true
    }

    return (
        <ConfigContext.Provider value={config}>
            {children}
        </ConfigContext.Provider>
    )
}

export function useConfig(): AppConfig {
    const ctx = useContext(ConfigContext)
    if (!ctx) {
        throw new Error('ConfigProvider is missing')
    }
    return ctx
}