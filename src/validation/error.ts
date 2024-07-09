import { HttpRequestType } from '../metrics/constants'
import { ResponseTimestamps } from '../util'

type ErrorBasic = {
  name: string
  message: string
}
type ErrorFull = ErrorBasic & {
  stack: string
  cause: string
}

export type AdapterErrorResponse = {
  status: string
  statusCode: number
  providerStatusCode?: number
  error: ErrorBasic | ErrorFull
}

export class AdapterError extends Error {
  status: string
  statusCode: number
  cause: unknown
  url?: string
  errorResponse: unknown
  feedID?: string
  providerStatusCode?: number
  metricsLabel?: HttpRequestType

  override name: string
  override message: string

  constructor({
    status = 'errored',
    statusCode = 500,
    name = 'AdapterError',
    message = 'There was an unexpected error in the adapter.',
    cause,
    url,
    feedID,
    errorResponse,
    providerStatusCode,
    metricsLabel = HttpRequestType.ADAPTER_ERROR,
  }: Partial<AdapterError>) {
    super(message)

    this.status = status
    this.statusCode = statusCode
    this.name = name
    this.message = message
    this.cause = cause
    if (url) {
      this.url = url
    }
    if (feedID) {
      this.feedID = feedID
    }
    this.errorResponse = errorResponse
    this.providerStatusCode = providerStatusCode
    this.metricsLabel = metricsLabel
  }

  toJSONResponse(): AdapterErrorResponse {
    const showDebugInfo = process.env['DEBUG'] === 'true'
    const errorBasic = {
      name: this.name,
      message: this.message,
      url: this.url,
      errorResponse: this.errorResponse,
      feedID: this.feedID,
    }
    const errorFull = { ...errorBasic, stack: this.stack, cause: this.cause }
    return {
      status: this.status,
      statusCode: this.statusCode,
      providerStatusCode: this.providerStatusCode,
      error: showDebugInfo ? errorFull : errorBasic,
    }
  }
}

export class AdapterInputError extends AdapterError {
  constructor(input: Partial<AdapterError>) {
    super({ ...input, metricsLabel: HttpRequestType.INPUT_ERROR })
  }
}
export class AdapterRateLimitError extends AdapterError {
  msUntilNextExecution: number

  constructor(
    input: Partial<AdapterError> & {
      msUntilNextExecution?: number
    },
  ) {
    super({ ...input, metricsLabel: HttpRequestType.RATE_LIMIT_ERROR })
    this.msUntilNextExecution = input.msUntilNextExecution ?? 0
  }
}
export class AdapterTimeoutError extends AdapterError {
  constructor(input: Partial<AdapterError>) {
    super({ ...input, metricsLabel: HttpRequestType.TIMEOUT_ERROR })
  }
}
export class AdapterDataProviderError extends AdapterError {
  constructor(input: Partial<AdapterError>, public timestamps: ResponseTimestamps) {
    super({ ...input, metricsLabel: HttpRequestType.DP_ERROR })
  }
}
export class AdapterConnectionError extends AdapterError {
  constructor(input: Partial<AdapterError>, public timestamps: ResponseTimestamps) {
    super({ ...input, metricsLabel: HttpRequestType.CONNECTION_ERROR })
  }
}
export class AdapterCustomError extends AdapterError {
  constructor(input: Partial<AdapterError>) {
    super({ ...input, metricsLabel: HttpRequestType.CUSTOM_ERROR })
  }
}

export class AdapterLWBAError extends AdapterError {
  constructor(input: Partial<AdapterError>) {
    super({
      ...input,
      name: 'AdapterLWBAError',
      metricsLabel: HttpRequestType.LWBA_ERROR,
    })
  }
}
