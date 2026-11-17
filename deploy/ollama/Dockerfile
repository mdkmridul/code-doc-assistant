# Ollama with nomic-embed-text baked in, CPU only, for a small Fly machine
# (ADR 0022). Same Ollama version as docker-compose.yml.
#
# The official image is ~8.5 GB, mostly CUDA/MLX/Vulkan libraries a CPU
# machine never loads. Stage 1 pulls the model and prunes those; stage 2 copies
# the binary, the CPU libraries and the model onto the same Ubuntu base.
FROM ollama/ollama:0.40.16 AS full

RUN ollama serve & pid=$!; \
    for _ in $(seq 1 30); do ollama list >/dev/null 2>&1 && break; sleep 1; done; \
    ollama pull nomic-embed-text; status=$?; \
    kill "$pid"; wait "$pid" 2>/dev/null; exit "$status"
RUN rm -rf /usr/lib/ollama/cuda_* /usr/lib/ollama/mlx_* /usr/lib/ollama/vulkan /usr/lib/ollama/include

FROM ubuntu:24.04
COPY --from=full /usr/bin/ollama /usr/bin/ollama
COPY --from=full /usr/lib/ollama /usr/lib/ollama
COPY --from=full /root/.ollama /root/.ollama

# Fly's private network is IPv6: listen on all IPv6 (and IPv4) addresses.
ENV OLLAMA_HOST=[::]:11434
EXPOSE 11434
ENTRYPOINT ["/usr/bin/ollama"]
CMD ["serve"]
