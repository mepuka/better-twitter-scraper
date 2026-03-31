import {
  Effect,
  Layer,
  Logger,
  Option,
  References,
  ServiceMap,
  Tracer,
} from "effect";

export type CapturedLogEntry = ReturnType<(typeof Logger.formatStructured)["log"]>;

export interface CapturedSpan {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly kind: Tracer.SpanKind;
  readonly name: string;
  readonly parentSpanId?: string;
  readonly spanId: string;
}

export class ObservabilityCapture extends ServiceMap.Service<
  ObservabilityCapture,
  {
    readonly logs: Effect.Effect<readonly CapturedLogEntry[]>;
    readonly spans: Effect.Effect<readonly CapturedSpan[]>;
  }
>()("@better-twitter-scraper/ObservabilityCapture") {
  static layer() {
    const logs: CapturedLogEntry[] = [];
    const spans: CapturedSpan[] = [];

    const captureLogger = Logger.make((options) => {
      logs.push(Logger.formatStructured.log(options));
    });

    const captureTracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        const originalEnd = span.end.bind(span);

        span.end = (endTime, exit) => {
          originalEnd(endTime, exit);
          spans.push({
            attributes: Object.fromEntries(span.attributes),
            kind: span.kind,
            name: span.name,
            ...(Option.isSome(span.parent)
              ? { parentSpanId: span.parent.value.spanId }
              : {}),
            spanId: span.spanId,
          });
        };

        return span;
      },
    });

    return Layer.mergeAll(
      Layer.succeed(ObservabilityCapture, {
        logs: Effect.sync(() => [...logs]),
        spans: Effect.sync(() => [...spans]),
      }),
      Logger.layer([captureLogger]),
      Layer.succeed(Tracer.Tracer, captureTracer),
      Layer.succeed(References.MinimumLogLevel, "Debug"),
    );
  }
}
