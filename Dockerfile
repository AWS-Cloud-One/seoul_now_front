FROM node:24.22.0-bookworm-slim AS development

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM development AS build
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_KAKAO_MAP_APP_KEY=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_KAKAO_MAP_APP_KEY=${VITE_KAKAO_MAP_APP_KEY}
RUN npm run build

# S3/CloudFront에 배포할 정적 파일을 내보내는 단계입니다.
FROM scratch AS export
COPY --from=build /app/dist/ /
