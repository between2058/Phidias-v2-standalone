import type { AppConfig } from './types'
import { usePhidiasStore } from '../store/phidias-store'

export function createConfigStandalone(): AppConfig {
    const config = {
        apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL!,
        hostapp: 'standalone',
    }
    usePhidiasStore.setState({ apiBaseUrl: config.apiBaseUrl })
    usePhidiasStore.setState({ hostapp: config.hostapp })
    return config
}