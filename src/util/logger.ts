import { randomUUID } from 'crypto'
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify'
import { AsyncLocalStorage } from 'node:async_hooks'
import pino from 'pino'
import pretty from 'pino-pretty'
import { BaseSettingsDefinition } from '../config'
import { EmptyInputParameters } from '../validation/input-params'
import CensorList, { CensorKeyValue } from './censor/censor-list'
import { AdapterRequest } from './types'

export const asyncLocalStorage = new AsyncLocalStorage()

export type Store = {
  correlationId: string
}

const stream = pretty({
  levelFirst: true,
  levelLabel: 'level',
  ignore: 'layer,pid,hostname,correlationId,color',
  messageFormat: `\x1b[0m[{correlationId}] {color}[{layer}]\x1b[0m {msg}`,
  translateTime: 'yyyy-mm-dd HH:MM:ss.l',
})

// Base logger, shouldn't be used because we want layers to be specified
const baseLogger = pino(
  {
    level: process.env['LOG_LEVEL']?.toLowerCase() || BaseSettingsDefinition.LOG_LEVEL.default,
    formatters: {
      level(label) {
        return { level: label }
      },
    },
    hooks: {
      logMethod(inputArgs, method) {
        // Censor each argument of logger
        const censorList = CensorList.getAll()
        return method.apply(
          this,
          inputArgs.map((arg) => censor(arg, censorList)) as [string, ...unknown[]],
        )
      },
    },
    mixin() {
      if (process.env['CORRELATION_ID_ENABLED'] !== 'false') {
        const store = asyncLocalStorage.getStore() as Store
        if (store) {
          return {
            correlationId: store.correlationId,
          }
        }
      }
      return {}
    },
  },
  process.env['DEBUG'] === 'true' ? stream : undefined,
)

export const COLORS = [
  '\u001b[31;1m',
  '\u001b[32m',
  '\u001b[33m',
  '\u001b[34m',
  '\u001b[35m',
  '\u001b[36m',
  '\u001b[38;2;121;85;72m',
  '\u001b[92m',
  '\u001b[93m',
  '\u001b[94m',
  '\u001b[95m',
  '\u001b[96m',
  '\u001b[38;5;202m',
  '\u001b[38;5;31m',
  '\u001b[38;5;130m',
  '\u001b[38;2;255;122;92m',
  '\u001b[38;2;46;125;50m',
  '\u001b[38;2;129;168;37m',
  '\u001b[38;2;175;180;43m',
  '\u001b[91m',
  '\u001b[38;2;63;81;181m',
]

export const colorFactory = (colors: string[]) => {
  let index = -1
  return () => {
    index++
    if (index > colors.length - 1) {
      index = 0
    }
    return colors[index]
  }
}

const getNextColor = colorFactory(COLORS)

/**
 * Object that will provide logger instances upon requests, based on the basic pino logger.
 */
export interface LoggerFactory {
  child(params: { layer: string; color?: string }): Omit<pino.BaseLogger, 'level' | 'silent'>
}

const defaultLoggerFactory = baseLogger

/**
 * Global class that will hold the logger factory.
 * This is easier than refactoring the entire framework to use a dependency injection framework,
 * and probably safer since all the popular ones use decorators that are still in the experimental stage.
 */
export class LoggerFactoryProvider {
  private static factory: LoggerFactory

  static set(factory: LoggerFactory = defaultLoggerFactory) {
    // If the factory has already been set, we want to warn the user because
    // the code might be calling this twice
    if (this.factory) {
      factory
        .child({ layer: 'LoggerFactory' })
        .warn(
          'The logger factory has been set twice in the provider, this will not affect existing global loggers',
        )
    }
    this.factory = factory
  }

  static get(): LoggerFactory {
    return this.factory
  }
}

/**
 * Instance of a logger, that will defer the construction of its methods until the first time any of them are called.
 * This is done so we can freely create these instances before the adapter is initialized, and allow
 * the global logger factory to be injected if the user so desires.
 */
class PlaceholderLogger {
  private levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

  constructor(layer: string) {
    const color = process.env['DEBUG'] === 'true' ? getNextColor() : undefined

    for (const level of this.levels) {
      this[level] = ((...args: Parameters<pino.LogFn>) => {
        // This is the first time any method is called for this logger.
        // We want to store the original arguments while we create the actual logger to call later.
        const firstExecutionArgs = args

        // If a logger factory was not set in the provider, error out.
        const factory = LoggerFactoryProvider.get()
        if (!factory) {
          throw new Error(
            'The logger factory provider does not have a factory set, you need to set one before executing any logging methods.',
          )
        }

        // We have a logger factory, so first we create a new child logger
        const logger = factory.child({
          layer,
          color,
        })

        // Replace all of this object's methods with the actual logger instance
        for (const _level of this.levels) {
          this[_level] = logger[_level].bind(logger)
        }

        // Finally, call the original intended logging function
        this[level](...firstExecutionArgs)
      }) as pino.LogFn
    }
  }

  fatal!: pino.LogFn
  error!: pino.LogFn
  warn!: pino.LogFn
  info!: pino.LogFn
  debug!: pino.LogFn
  trace!: pino.LogFn
}

/**
 * Instead of using a global logger instance, we want to force using a child logger
 * with a specific layer set in it, so that we can filter logs by where they're output from.
 *
 * Details on what each log level represents:
 * "trace": Forensic debugging of issues on a local machine.
 * "debug": Detailed logging level to get more context from users on their environments.
 * "info": High-level informational messages, to describe at a glance the high level state of the system.
 * "warn": A mild error occurred that might require non-urgent action.
 * "error": An unexpected error occurred during the regular operation of a well-maintained EA.
 * "fatal": The EA encountered an unrecoverable problem and had to exit.
 *
 * Full reference this is based on can be found at
 * https://github.com/smartcontractkit/documentation/blob/main/docs/Node%20Operators/configuration-variables.md#log_level
 *
 * @param layer - the layer name to include in the logs (e.g. "SomeMiddleware", "RedisCache", etc.)
 * @returns a layer specific logger
 */
export const makeLogger = (layer: string) => new PlaceholderLogger(layer)

export const loggingContextMiddleware = (
  rawReq: FastifyRequest,
  res: FastifyReply,
  done: HookHandlerDoneFunction,
) => {
  const req = rawReq as AdapterRequest<EmptyInputParameters>
  const correlationId = req.headers['x-correlation-id'] || randomUUID()
  asyncLocalStorage.run({ correlationId: correlationId }, () => {
    done()
  })
}

// Obj is typed as "any" because it could be a variety of structures in the logger
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function censor(obj: any, censorList: CensorKeyValue[], throwOnError = false) {
  let stringified: string | undefined = ''
  try {
    // JSON.stringify(obj) will fail if obj contains a circular reference.
    // If it fails, we fall back to replacing it with "[Unknown]".
    stringified = JSON.stringify(obj)
  } catch (e) {
    if (throwOnError) {
      throw e
    }
    return '[Unknown]'
  }

  if (typeof stringified !== 'string') {
    return undefined
  }

  let result: string = stringified
  censorList.forEach((entry) => {
    result = result.replace(entry.value, `[${entry.key} REDACTED]`)
  })
  return JSON.parse(result)
}

export const censorLogs = (logFunc: () => void) => {
  if (process.env['CENSOR_SENSITIVE_LOGS'] === 'true') {
    return
  }
  logFunc()
}
