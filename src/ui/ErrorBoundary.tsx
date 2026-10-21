import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 渲染期兜底。
 *
 * 教训：数据层一条 SQL 写错（别名用了关键字 to），整个 React 树就被卸载，
 * 页面只剩一片白 —— 用户看到的就是「没有任何内容」，连报错都看不到。
 * 所以这里把异常拦下来，显示一张能看懂、能自愈（重新加载）的卡片。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[render error]', err, info.componentStack);
  }

  render() {
    const err = this.state.err;
    if (!err) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h3>页面出错了</h3>
          <p className="muted">
            数据还在本地，没有被破坏。可以先重新加载；若反复出现，请到「设置 → 数据备份」导出一份备份。
          </p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={() => location.reload()}>
              重新加载
            </button>
            <button className="btn" onClick={() => this.setState({ err: null })}>
              重试一次
            </button>
          </div>
          <details>
            <summary className="muted small">技术细节</summary>
            <pre className="crash-detail">{err.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
