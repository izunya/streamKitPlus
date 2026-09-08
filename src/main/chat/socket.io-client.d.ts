/**
 * socket.io-client 2.x 최소 타입 선언.
 *
 * 치지직이 Socket.IO 1.0~2.0.3 프로토콜만 받아서 구버전을 씁니다.
 * 그 버전에는 타입 정의가 동봉되지 않고, @types/socket.io-client 는
 * 더 이상 관리되지 않아 여기에 필요한 만큼만 직접 적었습니다.
 */
declare module 'socket.io-client' {
  interface SocketOptions {
    reconnection?: boolean
    forceNew?: boolean
    timeout?: number
    transports?: string[]
  }

  interface Socket {
    on(event: string, listener: (...args: unknown[]) => void): Socket
    emit(event: string, ...args: unknown[]): Socket
    close(): Socket
    disconnect(): Socket
    connected: boolean
  }

  function io(uri: string, opts?: SocketOptions): Socket
  export default io
}
