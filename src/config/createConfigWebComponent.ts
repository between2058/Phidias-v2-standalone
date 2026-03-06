import type { AppConfig } from './types'
import { usePhidiasStore } from '../store/phidias-store'

export function createConfigWebComponent(element: HTMLElement): AppConfig {
    const config = {
        apiBaseUrl: element.getAttribute('api-base-url') ?? '',
        hostapp: element.getAttribute('host-app') ?? null,
    }
    usePhidiasStore.setState({ apiBaseUrl: config.apiBaseUrl })
    usePhidiasStore.setState({ hostapp: config.hostapp })
    return config
}